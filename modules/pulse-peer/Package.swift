// swift-tools-version:5.9
// Builds only the platform-neutral core so it can be unit-tested on macOS with `swift test`.
// The app itself links these sources through ios/PulsePeer.podspec.
import PackageDescription

let package = Package(
  name: "PulsePeerCore",
  platforms: [.macOS(.v13), .iOS(.v16)],
  targets: [
    .target(name: "PulsePeerCore", path: "ios/Core"),
    .testTarget(name: "PulsePeerCoreTests", dependencies: ["PulsePeerCore"], path: "ios/Tests"),
  ]
)
