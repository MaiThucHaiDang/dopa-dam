import SwiftUI

/// Dark theme values copied from shared/design-tokens/tokens.json (color, fontSize, radius, space).
enum Theme {
    static let bg = Color(hex: 0x0F1114)
    static let surface = Color(hex: 0x171A1F)
    static let surfaceRaised = Color(hex: 0x1F232A)
    static let border = Color(hex: 0x2E333B)
    static let text = Color(hex: 0xF3EFE6)
    static let textMuted = Color(hex: 0xB0ACA3)
    static let textFaint = Color(hex: 0x8C8981)
    static let accent = Color(hex: 0x5BB5A8)
    static let accentText = Color(hex: 0x0F1114)
    static let accentSoft = Color(hex: 0x1B3531)

    enum FontSize {
        static let small: CGFloat = 14
        static let base: CGFloat = 16
        static let large: CGFloat = 20
        static let title: CGFloat = 28
        static let hero: CGFloat = 36
    }

    enum Radius {
        static let sm: CGFloat = 6
        static let md: CGFloat = 10
        static let lg: CGFloat = 16
    }

    enum Space {
        static let xs: CGFloat = 4
        static let sm: CGFloat = 8
        static let md: CGFloat = 16
        static let lg: CGFloat = 24
        static let xl: CGFloat = 40
    }
}

extension Color {
    /// 0xRRGGBB in sRGB.
    init(hex: UInt32) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: 1)
    }
}
