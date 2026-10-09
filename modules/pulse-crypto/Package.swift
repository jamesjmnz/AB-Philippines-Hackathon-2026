// swift-tools-version:5.9
// Builds only the platform-neutral crypto core so it can be unit-tested on macOS with `swift test`.
// The app itself links these sources through ios/PulseCrypto.podspec.
import PackageDescription

let package = Package(
  name: "PulseCryptoCore",
  platforms: [.macOS(.v13), .iOS(.v16)],
  targets: [
    .target(name: "PulseCryptoCore", path: "ios/Core"),
    .testTarget(name: "PulseCryptoCoreTests", dependencies: ["PulseCryptoCore"], path: "ios/Tests"),
  ]
)
