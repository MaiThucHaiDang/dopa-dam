// swift-tools-version:5.9
import PackageDescription

let package = Package(
    name: "DopaDamCore",
    platforms: [.iOS(.v17), .macOS(.v13)],
    products: [
        .library(name: "DopaDamCore", targets: ["DopaDamCore"]),
    ],
    targets: [
        .target(name: "DopaDamCore"),
        .testTarget(name: "DopaDamCoreTests", dependencies: ["DopaDamCore"]),
    ]
)
