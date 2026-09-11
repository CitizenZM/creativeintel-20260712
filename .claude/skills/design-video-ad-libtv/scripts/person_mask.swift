// Write a person-segmentation mask (white = person incl. hands, black = background
// and held objects) so an official product photo can be slid *under* the fingers.
//
// Usage: swift person_mask.swift <input> <mask.png>
import AppKit
import CoreImage
import Vision

let args = CommandLine.arguments
guard args.count == 3 else {
    FileHandle.standardError.write("usage: person_mask.swift <input> <mask.png>\n".data(using: .utf8)!)
    exit(2)
}
guard let input = CIImage(contentsOf: URL(fileURLWithPath: args[1])) else { exit(1) }

let request = VNGeneratePersonSegmentationRequest()
request.qualityLevel = .accurate
request.outputPixelFormat = kCVPixelFormatType_OneComponent8
try VNImageRequestHandler(ciImage: input).perform([request])
guard let buffer = request.results?.first?.pixelBuffer else { exit(1) }

var mask = CIImage(cvPixelBuffer: buffer)
let sx = input.extent.width / mask.extent.width
let sy = input.extent.height / mask.extent.height
mask = mask.transformed(by: CGAffineTransform(scaleX: sx, y: sy))

let context = CIContext()
guard let cg = context.createCGImage(mask, from: input.extent) else { exit(1) }
let png = NSBitmapImageRep(cgImage: cg).representation(using: .png, properties: [:])!
try png.write(to: URL(fileURLWithPath: args[2]))
print("\(args[2]) \(cg.width)x\(cg.height)")
