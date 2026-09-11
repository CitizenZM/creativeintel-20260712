// Print detected face boxes in image pixels: "x y w h" per line (top-left origin).
// Used to QC product-to-face scale in generated keyframes.
//
// Usage: swift face_box.swift <image>
import AppKit
import Vision

let args = CommandLine.arguments
guard args.count == 2, let image = CIImage(contentsOf: URL(fileURLWithPath: args[1])) else { exit(2) }

let request = VNDetectFaceRectanglesRequest()
try VNImageRequestHandler(ciImage: image).perform([request])
let w = image.extent.width, h = image.extent.height
for face in request.results ?? [] {
    let b = face.boundingBox  // normalised, bottom-left origin
    let x = b.minX * w, y = (1 - b.maxY) * h
    print("\(Int(x)) \(Int(y)) \(Int(b.width * w)) \(Int(b.height * h))")
}
