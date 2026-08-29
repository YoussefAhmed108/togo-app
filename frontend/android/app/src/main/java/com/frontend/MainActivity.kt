package com.frontend

import android.content.Intent
import android.net.Uri
import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

class MainActivity : ReactActivity() {

  /**
   * Returns the name of the main component registered from JavaScript. This is used to schedule
   * rendering of the component.
   */
  override fun getMainComponentName(): String = "frontend"

  /**
   * Returns the instance of the [ReactActivityDelegate]. We use [DefaultReactActivityDelegate]
   * which allows you to enable New Architecture with a single boolean flags [fabricEnabled]
   */
  override fun createReactActivityDelegate(): ReactActivityDelegate =
      DefaultReactActivityDelegate(this, mainComponentName, fabricEnabled)

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    convertShareToDeepLink(intent)
  }

  /** launchMode is singleTask, so a share into an already-running app lands here. */
  override fun onNewIntent(intent: Intent?) {
    super.onNewIntent(intent)
    setIntent(intent)
    convertShareToDeepLink(intent)
  }

  /**
   * TikTok shares as plain text ("caption https://vt.tiktok.com/xxx/"), not as a
   * URL intent. Pull the link out and rewrite the intent as a deep link so
   * React Navigation's linking config routes it to CreatePlace.
   */
  private fun convertShareToDeepLink(intent: Intent?) {
    if (intent?.action != Intent.ACTION_SEND || intent.type != "text/plain") return

    val sharedText = intent.getStringExtra(Intent.EXTRA_TEXT) ?: return
    val match = TIKTOK_URL.find(sharedText) ?: return

    val deepLink = Uri.parse("placeapp://add-place?tiktokUrl=" + Uri.encode(match.value))
    setIntent(Intent(Intent.ACTION_VIEW, deepLink))
  }

  companion object {
    private val TIKTOK_URL = Regex("https?://(www\\.|vm\\.|vt\\.|m\\.)?tiktok\\.com/\\S+")
  }
}
