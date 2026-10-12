package com.dang.dopadam.ui.theme

import androidx.compose.material3.LocalContentColor
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight

private val colors = darkColorScheme(
    primary = Tokens.Accent,
    onPrimary = Tokens.AccentText,
    primaryContainer = Tokens.AccentSoft,
    onPrimaryContainer = Tokens.Text,
    secondary = Tokens.Accent,
    onSecondary = Tokens.AccentText,
    secondaryContainer = Tokens.AccentSoft,
    onSecondaryContainer = Tokens.Text,
    background = Tokens.Bg,
    onBackground = Tokens.Text,
    surface = Tokens.Bg,
    onSurface = Tokens.Text,
    surfaceVariant = Tokens.SurfaceRaised,
    onSurfaceVariant = Tokens.TextMuted,
    surfaceContainer = Tokens.Surface,
    surfaceContainerHigh = Tokens.SurfaceRaised,
    surfaceContainerHighest = Tokens.SurfaceRaised,
    surfaceContainerLow = Tokens.Surface,
    outline = Tokens.Border,
    outlineVariant = Tokens.Border,
)

private val typography = Typography(
    displaySmall = TextStyle(fontSize = Tokens.FontHero, fontWeight = FontWeight.SemiBold, lineHeight = Tokens.FontHero * 1.2f),
    headlineSmall = TextStyle(fontSize = Tokens.FontTitle, fontWeight = FontWeight.SemiBold, lineHeight = Tokens.FontTitle * 1.25f),
    titleMedium = TextStyle(fontSize = Tokens.FontLarge, fontWeight = FontWeight.SemiBold, lineHeight = Tokens.FontLarge * 1.3f),
    bodyLarge = TextStyle(fontSize = Tokens.FontBase, lineHeight = Tokens.FontBase * 1.5f),
    bodyMedium = TextStyle(fontSize = Tokens.FontBase, lineHeight = Tokens.FontBase * 1.5f),
    bodySmall = TextStyle(fontSize = Tokens.FontSmall, lineHeight = Tokens.FontSmall * 1.45f),
    labelLarge = TextStyle(fontSize = Tokens.FontBase, fontWeight = FontWeight.Medium),
)

@Composable
fun DopaTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = colors, typography = typography) {
        CompositionLocalProvider(LocalContentColor provides Tokens.Text, content = content)
    }
}
