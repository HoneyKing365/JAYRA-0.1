package ai.jayra.companion.ui.tabs

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import ai.jayra.companion.model.ReActStage
import ai.jayra.companion.model.TaskItem
import ai.jayra.companion.model.DailySummaryPayload
import ai.jayra.companion.theme.*

@Composable
fun TasksTab(
    activeTasks: List<TaskItem>,
    latestReActStage: ReActStage?,
    dailySummary: DailySummaryPayload? = null,
    onStopTask: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier
            .fillMaxSize()
            .background(JayraOledBlack)
            .padding(16.dp)
    ) {
        // Section Header
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column {
                Text(
                    text = "AUTONOMOUS REASONING",
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold,
                    fontSize = 15.sp,
                    letterSpacing = 1.sp,
                    color = JayraCyanPrimary
                )
                Text(
                    text = "Desktop ReAct Tasks & Execution Audit",
                    fontFamily = FontFamily.SansSerif,
                    fontSize = 11.sp,
                    color = TextMuted
                )
            }

            Box(
                modifier = Modifier
                    .clip(RoundedCornerShape(12.dp))
                    .background(JayraCyanSubtle)
                    .border(1.dp, BorderCyanGlowing, RoundedCornerShape(12.dp))
                    .padding(horizontal = 10.dp, vertical = 4.dp)
            ) {
                Text(
                    text = "${activeTasks.size} ACTIVE",
                    fontFamily = FontFamily.Monospace,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    color = JayraCyanPrimary
                )
            }
        }

        Spacer(modifier = Modifier.height(14.dp))

        // Daily Board Pulse Card (synced from Knowledge Graph)
        if (dailySummary != null) {
            DailyBoardPulseCard(summary = dailySummary)
            Spacer(modifier = Modifier.height(14.dp))
        }

        // Live ReAct Status Card
        if (latestReActStage != null) {
            LiveReActCard(stage = latestReActStage)
            Spacer(modifier = Modifier.height(14.dp))
        }

        // Tasks & History List
        if (activeTasks.isEmpty()) {
            Box(
                modifier = Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .clip(RoundedCornerShape(16.dp))
                    .background(JayraNavySurface)
                    .border(1.dp, BorderSubtle, RoundedCornerShape(16.dp)),
                contentAlignment = Alignment.Center
            ) {
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(
                        imageVector = Icons.Default.TaskAlt,
                        contentDescription = null,
                        tint = TextMuted,
                        modifier = Modifier.size(36.dp)
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "NO RUNNING TASKS",
                        fontFamily = FontFamily.Monospace,
                        fontSize = 12.sp,
                        fontWeight = FontWeight.SemiBold,
                        color = TextMuted
                    )
                    Text(
                        text = "Speak or send a command to start a desktop action",
                        fontFamily = FontFamily.SansSerif,
                        fontSize = 11.sp,
                        color = TextDim
                    )
                }
            }
        } else {
            LazyColumn(
                modifier = Modifier.weight(1f),
                verticalArrangement = Arrangement.spacedBy(10.dp)
            ) {
                items(activeTasks) { task ->
                    TaskCard(task = task, onStop = { onStopTask(task.id) })
                }
            }
        }
    }
}

@Composable
fun DailyBoardPulseCard(summary: DailySummaryPayload) {
    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(JayraCardSurface)
            .border(1.dp, BorderCyanGlowing, RoundedCornerShape(16.dp))
            .padding(14.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = Icons.Default.Bolt,
                    contentDescription = "Pulse",
                    tint = JayraCyanPrimary,
                    modifier = Modifier.size(16.dp)
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text = "DAILY RETROSPECTIVE PULSE",
                    fontFamily = FontFamily.Monospace,
                    fontWeight = FontWeight.Bold,
                    fontSize = 11.sp,
                    color = JayraCyanPrimary
                )
            }
            Text(
                text = "${summary.productivityScore}% PRODUCTIVE",
                fontFamily = FontFamily.Monospace,
                fontSize = 10.sp,
                fontWeight = FontWeight.Bold,
                color = JayraEmeraldSuccess
            )
        }

        Spacer(modifier = Modifier.height(8.dp))

        // Retrospective quote (multilingual fallback)
        val quote = summary.sassySummary["romanUrdu"]
            ?: summary.sassySummary["romanHindi"]
            ?: summary.sassySummary["hinglish"]
            ?: summary.sassySummary["english"]
            ?: "Knowledge Graph pulse synced from desktop."

        Text(
            text = "\"$quote\"",
            fontFamily = FontFamily.SansSerif,
            fontSize = 12.sp,
            color = TextLight,
            modifier = Modifier.padding(vertical = 4.dp)
        )

        Spacer(modifier = Modifier.height(6.dp))

        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween
        ) {
            Text(
                text = "⏱ Focus: ${summary.focusHours}h (${summary.focusMinutes}m)",
                fontFamily = FontFamily.Monospace,
                fontSize = 10.sp,
                color = TextMuted
            )
            Text(
                text = "⚡ Vibe: ${summary.vibeBaseline}",
                fontFamily = FontFamily.Monospace,
                fontSize = 10.sp,
                color = JayraCyanPrimary
            )
        }

        if (summary.recommendedTodos.isNotEmpty()) {
            Spacer(modifier = Modifier.height(8.dp))
            HorizontalDivider(color = BorderSubtle, thickness = 1.dp)
            Spacer(modifier = Modifier.height(6.dp))
            Text(
                text = "PRIORITIES FOR TODAY:",
                fontFamily = FontFamily.Monospace,
                fontSize = 9.sp,
                color = TextMuted
            )
            summary.recommendedTodos.take(3).forEach { todo ->
                Text(
                    text = "▫ $todo",
                    fontFamily = FontFamily.SansSerif,
                    fontSize = 11.sp,
                    color = TextLight,
                    modifier = Modifier.padding(vertical = 1.dp)
                )
            }
        }
    }
}

@Composable
private fun LiveReActCard(stage: ReActStage) {
    val stageColor = when (stage.stage.uppercase()) {
        "THOUGHT" -> JayraCyanPrimary
        "ACTION" -> JayraAmberWarning
        "OBSERVATION" -> JayraEmeraldSuccess
        else -> TextWhitePrimary
    }

    Box(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(JayraCardSurface)
            .border(1.dp, stageColor.copy(alpha = 0.5f), RoundedCornerShape(16.dp))
            .padding(14.dp)
    ) {
        Column {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "STAGE: ${stage.stage.uppercase()} (ITERATION ${stage.iteration}/${stage.maxIterations})",
                    fontFamily = FontFamily.Monospace,
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Bold,
                    letterSpacing = 1.sp,
                    color = stageColor
                )
                Box(
                    modifier = Modifier
                        .size(8.dp)
                        .clip(RoundedCornerShape(4.dp))
                        .background(stageColor)
                )
            }

            Spacer(modifier = Modifier.height(6.dp))

            val content = stage.plan ?: stage.action ?: stage.details ?: stage.status ?: "Processing step..."
            Text(
                text = content,
                fontFamily = FontFamily.Monospace,
                fontSize = 12.sp,
                lineHeight = 17.sp,
                color = TextWhitePrimary
            )
        }
    }
}

@Composable
private fun TaskCard(task: TaskItem, onStop: () -> Unit) {
    var expanded by remember { mutableStateOf(false) }

    Column(
        modifier = Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(14.dp))
            .background(JayraCardSurface)
            .border(1.dp, BorderSubtle, RoundedCornerShape(14.dp))
            .clickable { expanded = !expanded }
            .padding(12.dp)
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = task.goal,
                    fontFamily = FontFamily.SansSerif,
                    fontWeight = FontWeight.SemiBold,
                    fontSize = 13.sp,
                    color = TextWhitePrimary
                )
                Spacer(modifier = Modifier.height(2.dp))
                Text(
                    text = "STATUS: ${task.state.uppercase()} • STEPS: ${task.stages.size}",
                    fontFamily = FontFamily.Monospace,
                    fontSize = 9.sp,
                    color = if (task.state == "completed") JayraEmeraldSuccess else JayraCyanPrimary
                )
            }

            IconButton(onClick = onStop, modifier = Modifier.size(28.dp)) {
                Icon(
                    imageVector = Icons.Default.Close,
                    contentDescription = "Stop Task",
                    tint = JayraCrimsonDanger,
                    modifier = Modifier.size(16.dp)
                )
            }
        }

        AnimatedVisibility(visible = expanded && task.stages.isNotEmpty()) {
            Column(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(top = 10.dp)
            ) {
                Divider(color = BorderSubtle, thickness = 1.dp)
                Spacer(modifier = Modifier.height(8.dp))

                task.stages.takeLast(5).forEach { stage ->
                    Text(
                        text = "• [${stage.stage}] ${stage.action ?: stage.plan ?: stage.status ?: ""}",
                        fontFamily = FontFamily.Monospace,
                        fontSize = 10.sp,
                        color = TextMuted,
                        modifier = Modifier.padding(vertical = 2.dp)
                    )
                }
            }
        }
    }
}
