# Build
FROM golang:1.25-alpine AS build
WORKDIR /src
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN CGO_ENABLED=0 go build -ldflags="-s -w" -o /server ./cmd/server

# Run
FROM alpine:3.20
# The TikTok extract pipeline shells out to ffmpeg and yt-dlp.
# yt-dlp comes from its latest release, not apk: TikTok breaks old extractors,
# and each rebuild picks up the newest one.
RUN apk add --no-cache ca-certificates ffmpeg python3
ADD https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp /usr/local/bin/yt-dlp
RUN chmod 755 /usr/local/bin/yt-dlp
COPY --from=build /server /server
USER nobody
EXPOSE 8080
ENTRYPOINT ["/server"]
