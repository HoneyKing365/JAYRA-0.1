package ai.jayra.companion.ui.components

import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.dp
import ai.jayra.companion.model.CharacterVisualState
import ai.jayra.companion.theme.*
import kotlin.math.cos
import kotlin.math.sin

/**
 * HolographicAvatar
 *
 * Renders an Iron Man / JARVIS Arc-Reactor holographic core in native Compose Canvas.
 * Dynamically synchronizes state, rotation speed, and expansion pulse with the
 * desktop Gyra model's live visual state ("listening", "speaking", "thinking", "idle").
 */
@Composable
fun HolographicAvatar(
    visualState: CharacterVisualState,
    modifier: Modifier = Modifier
) {
    val infiniteTransition = rememberInfiniteTransition(label = "arc_reactor")

    // Outer ring rotation
    val outerRotation by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 360f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = if (visualState.state == "thinking") 4000 else 16000, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "outer_rot"
    )

    // Inner reverse rotation
    val innerRotation by infiniteTransition.animateFloat(
        initialValue = 360f,
        targetValue = 0f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = if (visualState.state == "thinking") 3000 else 10000, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "inner_rot"
    )

    // Core breathing / audio pulse
    val pulseScale by infiniteTransition.animateFloat(
        initialValue = 0.92f,
        targetValue = if (visualState.state == "speaking") 1.15f else if (visualState.state == "listening") 1.08f else 1.02f,
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = if (visualState.state == "speaking") 400 else 1500, easing = FastOutSlowInEasing),
            repeatMode = RepeatMode.Reverse
        ),
        label = "core_pulse"
    )

    val primaryColor = when (visualState.state) {
        "speaking" -> JayraCyanPrimary
        "listening" -> JayraEmeraldSuccess
        "thinking" -> JayraAmberWarning
        else -> JayraCyanPrimary
    }

    Box(
        modifier = modifier.size(240.dp),
        contentAlignment = Alignment.Center
    ) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            val center = Offset(size.width / 2f, size.height / 2f)
            val baseRadius = size.minDimension / 2.5f

            // 1. Ambient Background Glow
            drawCircle(
                brush = Brush.radialGradient(
                    colors = listOf(primaryColor.copy(alpha = 0.25f), Color.Transparent),
                    center = center,
                    radius = baseRadius * 1.5f * pulseScale
                ),
                radius = baseRadius * 1.5f * pulseScale,
                center = center
            )

            // 2. Outer Segmented Ring
            val outerRadius = baseRadius * 1.05f
            drawCircle(
                color = primaryColor.copy(alpha = 0.2f),
                radius = outerRadius,
                center = center,
                style = Stroke(width = 2.dp.toPx())
            )

            val segments = 8
            val sweep = 360f / segments
            for (i in 0 until segments) {
                val startAngle = outerRotation + (i * sweep)
                drawArc(
                    color = primaryColor.copy(alpha = 0.85f),
                    startAngle = startAngle,
                    sweepAngle = sweep * 0.45f,
                    useCenter = false,
                    topLeft = Offset(center.x - outerRadius, center.y - outerRadius),
                    size = androidx.compose.ui.geometry.Size(outerRadius * 2, outerRadius * 2),
                    style = Stroke(width = 3.5.dp.toPx(), cap = StrokeCap.Round)
                )
            }

            // 3. Middle Counter-Rotating Ring
            val middleRadius = baseRadius * 0.78f
            for (i in 0 until 6) {
                val angle = innerRotation + (i * 60f)
                drawArc(
                    color = primaryColor.copy(alpha = 0.7f),
                    startAngle = angle,
                    sweepAngle = 35f,
                    useCenter = false,
                    topLeft = Offset(center.x - middleRadius, center.y - middleRadius),
                    size = androidx.compose.ui.geometry.Size(middleRadius * 2, middleRadius * 2),
                    style = Stroke(width = 2.5.dp.toPx())
                )
            }

            // 4. Radiant Spokes
            for (i in 0 until 12) {
                val rad = Math.toRadians((outerRotation * 0.5f + i * 30f).toDouble())
                val innerPoint = Offset(
                    (center.x + (baseRadius * 0.45f) * cos(rad)).toFloat(),
                    (center.y + (baseRadius * 0.45f) * sin(rad)).toFloat()
                )
                val outerPoint = Offset(
                    (center.x + (baseRadius * 0.72f) * cos(rad)).toFloat(),
                    (center.y + (baseRadius * 0.72f) * sin(rad)).toFloat()
                )
                drawLine(
                    color = primaryColor.copy(alpha = 0.4f),
                    start = innerPoint,
                    end = outerPoint,
                    strokeWidth = 1.5.dp.toPx()
                )
            }

            // 5. Center Arc Core
            val coreRadius = baseRadius * 0.38f * pulseScale
            drawCircle(
                brush = Brush.radialGradient(
                    colors = listOf(Color.White, primaryColor, primaryColor.copy(alpha = 0.3f)),
                    center = center,
                    radius = coreRadius
                ),
                radius = coreRadius,
                center = center
            )
            drawCircle(
                color = Color.White,
                radius = coreRadius * 0.45f,
                center = center
            )
        }
    }
}
