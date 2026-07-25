import UserNotifications
import ImageIO
import MobileCoreServices

// Notification Service Extension: when the relay sets aps.mutable-content = 1 and
// includes a `tmPortraitUrl` custom key (see relay/src/index.ts), iOS wakes this
// extension before showing the banner. We download the character portrait and
// attach it so the notification shows the portrait instead of only the app icon.
//
// Portraits are re-encoded to PNG via ImageIO before attaching. Foundry art is
// often WebP, which UNNotificationAttachment does not accept directly, but
// ImageIO can decode it — so re-encoding both normalises the format and rejects
// anything that isn't a real image. If any step fails we deliver the original
// notification unchanged; the image is a nice-to-have, never a blocker.
class NotificationService: UNNotificationServiceExtension {
    private var contentHandler: ((UNNotificationContent) -> Void)?
    private var bestAttempt: UNMutableNotificationContent?
    private var downloadTask: URLSessionTask?

    override func didReceive(
        _ request: UNNotificationRequest,
        withContentHandler contentHandler: @escaping (UNNotificationContent) -> Void
    ) {
        self.contentHandler = contentHandler
        let content = request.content.mutableCopy() as? UNMutableNotificationContent
        self.bestAttempt = content

        guard
            let content = content,
            let urlString = request.content.userInfo["tmPortraitUrl"] as? String,
            let url = URL(string: urlString),
            url.scheme == "http" || url.scheme == "https"
        else {
            contentHandler(request.content)
            return
        }

        downloadTask = URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
            guard let self = self else { return }
            if let data = data, let attachment = Self.pngAttachment(from: data) {
                content.attachments = [attachment]
            }
            self.deliver()
        }
        downloadTask?.resume()
    }

    // iOS gives the extension a limited window (~30s). If we run out, deliver what
    // we have — with the image if it already landed, without it otherwise.
    override func serviceExtensionTimeWillExpire() {
        downloadTask?.cancel()
        deliver()
    }

    private func deliver() {
        guard let handler = contentHandler, let content = bestAttempt else { return }
        contentHandler = nil
        handler(content)
    }

    // Decode arbitrary image bytes (incl. WebP) and re-encode to a PNG temp file,
    // then wrap it as a notification attachment. Returns nil if the bytes aren't a
    // decodable image or the file can't be written.
    private static func pngAttachment(from data: Data) -> UNNotificationAttachment? {
        guard
            let source = CGImageSourceCreateWithData(data as CFData, nil),
            let image = CGImageSourceCreateImageAtIndex(source, 0, nil)
        else { return nil }

        let dir = URL(fileURLWithPath: NSTemporaryDirectory(), isDirectory: true)
            .appendingPathComponent(UUID().uuidString, isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let fileURL = dir.appendingPathComponent("portrait.png")

        guard
            let dest = CGImageDestinationCreateWithURL(fileURL as CFURL, kUTTypePNG, 1, nil)
        else { return nil }
        CGImageDestinationAddImage(dest, image, nil)
        guard CGImageDestinationFinalize(dest) else { return nil }

        return try? UNNotificationAttachment(identifier: "portrait", url: fileURL, options: nil)
    }
}
