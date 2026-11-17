import Foundation
import XCTest

/// Loads the shared JSON vectors. They live in `<repo>/shared/test-vectors`, found from this file's path
/// (`#filePath`) and overridable with the environment variable `DOPADAM_VECTORS`.
enum Vectors {
    static func directory(file: String = #filePath) -> URL {
        if let override = ProcessInfo.processInfo.environment["DOPADAM_VECTORS"], !override.isEmpty {
            return URL(fileURLWithPath: override, isDirectory: true)
        }
        var url = URL(fileURLWithPath: file)
        // .../ios/native/DopaDamCore/Tests/DopaDamCoreTests/Vectors.swift -> repository root is 6 levels up.
        for _ in 0..<6 { url.deleteLastPathComponent() }
        return url.appendingPathComponent("shared").appendingPathComponent("test-vectors", isDirectory: true)
    }

    static func load<T: Decodable>(_ name: String, _ type: T.Type = T.self, file: String = #filePath) throws -> T {
        let url = directory(file: file).appendingPathComponent(name)
        let data = try Data(contentsOf: url)
        return try JSONDecoder().decode(T.self, from: data)
    }
}
