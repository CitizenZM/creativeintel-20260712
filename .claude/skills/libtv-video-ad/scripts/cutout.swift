// Lift the foreground subject from a product photo into a transparent PNG.
// Uses Apple Vision's on-device foreground instance mask (macOS 14+), so frosted
// white bottle layers are not eaten the way a white-threshold key would.
//
// Usage: swift cutout.swift <input> <output.png>
import AppKit
import CoreImage
import Vision

let args = CommandLine.arguments
guard args.count == 3 else {
    FileHandle.standardError.write("usage: cutout.swift <input> <output.png>\n".data(using: .utf8)!)
    exit(2)
}
let inURL = URL(fileURLWithPath: args[1])
let outURL = URL(fileURLWithPath: args[2])

guard let ciInput = CIImage(contentsOf: inURL, options: [.applyOrientationProperty: true]) else {
    FileHandle.standardError.write("cannot read \(inURL.path)\n".data(using: .utf8)!)
    exit(1)
}

let handler = VNImageRequestHandler(ciImage: ciInput)
let request = VNGenerateForegroundInstanceMaskRequest()
do {
    try handler.perform([request])
} catch {
    FileHandle.standardError.write("vision failed: \(error)\n".data(using: .utf8)!)
    exit(1)
}
guard let result = request.results?.first, !result.allInstances.isEmpty else {
    FileHandle.standardError.write("no foreground found\n".data(using: .utf8)!)
    exit(1)
}

let maskBuffer = try result.generateScaledMaskForImage(forInstances: result.allInstances, from: handler)
let mask = CIImage(cvPixelBuffer: maskBuffer)
let clear = CIImage(color: .clear).cropped(to: ciInput.extent)
let blended = ciInput.applyingFilter("CIBlendWithMask", parameters: [
    kCIInputBackgroundImageKey: clear,
    kCIInputMaskImageKey: mask,
])

let context = CIContext()
guard let cg = context.createCGImage(blended, from: ciInput.extent) else { exit(1) }
let rep = NSBitmapImageRep(cgImage: cg)
guard let png = rep.representation(using: .png, properties: [:]) else { exit(1) }
try png.write(to: outURL)
print("\(outURL.path) \(cg.width)x\(cg.height) instances=\(result.allInstances.count)")
