package ai.jayra.companion.net

import kotlinx.coroutines.*
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import java.util.concurrent.ConcurrentLinkedQueue

/**
 * FluidTextStreamingBuffer
 *
 * Solves the choppy single-letter streaming rendering issue.
 * Ingests incoming WebSocket token fragments into a thread-safe queue and emits
 * smooth, fluid word-cadence transitions onto the Compose UI at 18-24ms intervals.
 * Automatically adapts animation speed when bursts occur to ensure zero latency lag.
 */
class FluidTextStreamingBuffer(
    private val scope: CoroutineScope
) {
    private val _visibleText = MutableStateFlow("")
    val visibleText: StateFlow<String> = _visibleText.asStateFlow()

    private val _isStreaming = MutableStateFlow(false)
    val isStreaming: StateFlow<Boolean> = _isStreaming.asStateFlow()

    private val tokenQueue = ConcurrentLinkedQueue<String>()
    private var streamingJob: Job? = null
    private val fullBuffer = StringBuilder()

    fun appendChunk(chunk: String) {
        if (chunk.isEmpty()) return
        fullBuffer.append(chunk)

        // Split incoming chunk into small natural tokens (words or punctuation)
        val tokens = splitIntoTokens(chunk)
        tokenQueue.addAll(tokens)

        if (streamingJob?.isActive != true) {
            startStreamingLoop()
        }
    }

    fun completeStream(finalText: String? = null) {
        scope.launch {
            if (finalText != null && finalText.isNotEmpty()) {
                fullBuffer.clear()
                fullBuffer.append(finalText)
            }
            // Drain remaining queue rapidly
            while (tokenQueue.isNotEmpty()) {
                val token = tokenQueue.poll() ?: break
                _visibleText.value += token
                delay(6)
            }
            if (finalText != null) {
                _visibleText.value = finalText
            }
            _isStreaming.value = false
            streamingJob?.cancel()
            streamingJob = null
        }
    }

    fun reset() {
        tokenQueue.clear()
        fullBuffer.clear()
        _visibleText.value = ""
        _isStreaming.value = false
        streamingJob?.cancel()
        streamingJob = null
    }

    private fun startStreamingLoop() {
        _isStreaming.value = true
        streamingJob = scope.launch {
            val stringBuilder = StringBuilder(_visibleText.value)

            while (isActive) {
                val token = tokenQueue.poll()
                if (token != null) {
                    stringBuilder.append(token)
                    _visibleText.value = stringBuilder.toString()

                    // Adaptive pacing: speed up if queue is large, otherwise smooth 20ms
                    val delayMs = when {
                        tokenQueue.size > 20 -> 5L
                        tokenQueue.size > 10 -> 10L
                        tokenQueue.size > 4 -> 16L
                        else -> 22L
                    }
                    delay(delayMs)
                } else {
                    // Queue empty; wait briefly for more chunks
                    delay(30)
                    if (tokenQueue.isEmpty()) {
                        break
                    }
                }
            }
            _isStreaming.value = false
        }
    }

    private fun splitIntoTokens(text: String): List<String> {
        val result = mutableListOf<String>()
        val currentWord = StringBuilder()

        for (char in text) {
            currentWord.append(char)
            if (char == ' ' || char == '\n' || char == '.' || char == ',' || char == '!' || char == '?') {
                result.add(currentWord.toString())
                currentWord.clear()
            }
        }
        if (currentWord.isNotEmpty()) {
            result.add(currentWord.toString())
        }
        return result
    }
}
