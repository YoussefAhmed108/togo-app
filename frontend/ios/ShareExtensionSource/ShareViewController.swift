import UIKit
import UniformTypeIdentifiers

/// Receives a TikTok share and reopens the main app on the add-place deep link.
///
/// The extension does no work of its own — extraction needs the user's auth
/// token and takes ~15s, both of which belong in the main app.
class ShareViewController: UIViewController {

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        handleSharedContent()
    }

    private func handleSharedContent() {
        guard let items = extensionContext?.inputItems as? [NSExtensionItem] else {
            return close()
        }

        for item in items {
            for provider in item.attachments ?? [] {
                if provider.hasItemConformingToTypeIdentifier(UTType.url.identifier) {
                    provider.loadItem(forTypeIdentifier: UTType.url.identifier, options: nil) { [weak self] value, _ in
                        if let url = value as? URL {
                            self?.openMainApp(with: url.absoluteString)
                        } else {
                            self?.close()
                        }
                    }
                    return
                }
                // TikTok usually shares a caption with the link inside it.
                if provider.hasItemConformingToTypeIdentifier(UTType.plainText.identifier) {
                    provider.loadItem(forTypeIdentifier: UTType.plainText.identifier, options: nil) { [weak self] value, _ in
                        if let text = value as? String, let url = self?.tiktokURL(in: text) {
                            self?.openMainApp(with: url)
                        } else {
                            self?.close()
                        }
                    }
                    return
                }
            }
        }
        close()
    }

    private func tiktokURL(in text: String) -> String? {
        let pattern = #"https?://(www\.|vm\.|vt\.|m\.)?tiktok\.com/\S+"#
        guard let regex = try? NSRegularExpression(pattern: pattern),
              let match = regex.firstMatch(in: text, range: NSRange(text.startIndex..., in: text)),
              let range = Range(match.range, in: text) else { return nil }
        return String(text[range])
    }

    private func openMainApp(with tiktokURL: String) {
        guard let encoded = tiktokURL.addingPercentEncoding(withAllowedCharacters: .alphanumerics),
              let appURL = URL(string: "placeapp://add-place?tiktokUrl=\(encoded)") else {
            return close()
        }

        // Share extensions cannot touch UIApplication.shared, so walk the
        // responder chain to find it.
        var responder: UIResponder? = self
        while let r = responder {
            if let app = r as? UIApplication {
                app.open(appURL, options: [:], completionHandler: nil)
                break
            }
            responder = r.next
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.3) { self.close() }
    }

    private func close() {
        DispatchQueue.main.async {
            self.extensionContext?.completeRequest(returningItems: nil, completionHandler: nil)
        }
    }
}
