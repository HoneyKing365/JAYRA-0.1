package ai.jayra.companion.theme

import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable

private val DarkColorScheme = darkColorScheme(
    primary = JayraCyanPrimary,
    onPrimary = JayraOledBlack,
    primaryContainer = JayraCardSurface,
    onPrimaryContainer = JayraCyanPrimary,
    secondary = JayraEmeraldSuccess,
    onSecondary = JayraOledBlack,
    surface = JayraNavySurface,
    onSurface = TextWhitePrimary,
    background = JayraOledBlack,
    onBackground = TextWhitePrimary,
    error = JayraCrimsonDanger,
    onError = TextWhitePrimary
)

@Composable
fun JayraCompanionTheme(
    content: @Composable () -> Unit
) {
    MaterialTheme(
        colorScheme = DarkColorScheme,
        typography = JayraTypography,
        content = content
    )
}
