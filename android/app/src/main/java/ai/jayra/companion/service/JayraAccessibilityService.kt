package ai.jayra.companion.service

import android.accessibilityservice.AccessibilityService
import android.accessibilityservice.GestureDescription
import android.graphics.Path
import android.graphics.Rect
import android.os.Bundle
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityNodeInfo
import ai.jayra.companion.model.AccessibilityNodeData
import java.util.concurrent.atomic.AtomicReference

class JayraAccessibilityService : AccessibilityService() {

    companion object {
        private val instanceRef = AtomicReference<JayraAccessibilityService?>(null)

        val isRunning: Boolean
            get() = instanceRef.get() != null

        val instance: JayraAccessibilityService?
            get() = instanceRef.get()
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instanceRef.set(this)
    }

    override fun onDestroy() {
        super.onDestroy()
        instanceRef.compareAndSet(this, null)
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {
        // Events are filtered and processed on-demand
    }

    override fun onInterrupt() {}

    /**
     * Traverses the active window's accessibility node tree up to maxDepth
     * and produces a structured hierarchy snapshot.
     */
    fun inspectScreenHierarchy(maxDepth: Int = 10): AccessibilityNodeData? {
        val root = rootInActiveWindow ?: return null
        return parseNode(root, 0, maxDepth)
    }

    private fun parseNode(node: AccessibilityNodeInfo, currentDepth: Int, maxDepth: Int): AccessibilityNodeData {
        val bounds = Rect().also { node.getBoundsInScreen(it) }
        val children = mutableListOf<AccessibilityNodeData>()

        if (currentDepth < maxDepth) {
            for (i in 0 until node.childCount) {
                val child = node.getChild(i) ?: continue
                children.add(parseNode(child, currentDepth + 1, maxDepth))
                child.recycle()
            }
        }

        return AccessibilityNodeData(
            viewId = node.viewIdResourceName,
            text = node.text?.toString(),
            contentDescription = node.contentDescription?.toString(),
            className = node.className?.toString(),
            bounds = "${bounds.left},${bounds.top},${bounds.right},${bounds.bottom}",
            isClickable = node.isClickable,
            isScrollable = node.isScrollable,
            isEditable = node.isEditable,
            children = children
        )
    }

    /**
     * Executes precision clicks, gestures, text input, or global navigation.
     */
    fun performAction(
        actionType: String,
        targetViewId: String? = null,
        targetText: String? = null,
        inputText: String? = null,
        x: Float? = null,
        y: Float? = null
    ): Result<String> {
        val root = rootInActiveWindow

        return when (actionType.uppercase()) {
            "GLOBAL_BACK" -> {
                performGlobalAction(GLOBAL_ACTION_BACK)
                Result.success("Navigated BACK")
            }
            "GLOBAL_HOME" -> {
                performGlobalAction(GLOBAL_ACTION_HOME)
                Result.success("Navigated HOME")
            }
            "GLOBAL_RECENTS" -> {
                performGlobalAction(GLOBAL_ACTION_RECENTS)
                Result.success("Opened RECENTS")
            }
            "GLOBAL_NOTIFICATIONS" -> {
                performGlobalAction(GLOBAL_ACTION_NOTIFICATIONS)
                Result.success("Opened NOTIFICATIONS")
            }
            "GLOBAL_QUICK_SETTINGS" -> {
                performGlobalAction(GLOBAL_ACTION_QUICK_SETTINGS)
                Result.success("Opened QUICK SETTINGS")
            }
            "CLICK_COORDINATES" -> {
                if (x != null && y != null) {
                    dispatchClickGesture(x, y)
                } else {
                    Result.failure(IllegalArgumentException("Coordinates x and y are required"))
                }
            }
            "CLICK" -> {
                val node = findTargetNode(root, targetViewId, targetText)
                    ?: return Result.failure(NoSuchElementException("Target node not found: id=$targetViewId, text=$targetText"))
                val clicked = node.performAction(AccessibilityNodeInfo.ACTION_CLICK)
                node.recycle()
                if (clicked) Result.success("Click performed on target") else Result.failure(IllegalStateException("Node click rejected"))
            }
            "LONG_CLICK" -> {
                val node = findTargetNode(root, targetViewId, targetText)
                    ?: return Result.failure(NoSuchElementException("Target node not found: id=$targetViewId, text=$targetText"))
                val longClicked = node.performAction(AccessibilityNodeInfo.ACTION_LONG_CLICK)
                node.recycle()
                if (longClicked) Result.success("Long-click performed on target") else Result.failure(IllegalStateException("Node long-click rejected"))
            }
            "SET_TEXT" -> {
                val node = findTargetNode(root, targetViewId, targetText)
                    ?: return Result.failure(NoSuchElementException("Target editable node not found"))
                val args = Bundle().apply {
                    putCharSequence(AccessibilityNodeInfo.ACTION_ARGUMENT_SET_TEXT_CHARSEQUENCE, inputText ?: "")
                }
                val set = node.performAction(AccessibilityNodeInfo.ACTION_SET_TEXT, args)
                node.recycle()
                if (set) Result.success("Text set successfully") else Result.failure(IllegalStateException("Failed setting text"))
            }
            "SCROLL_FORWARD" -> {
                val node = root?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: root
                val scrolled = node?.performAction(AccessibilityNodeInfo.ACTION_SCROLL_FORWARD) ?: false
                if (scrolled) Result.success("Scrolled forward") else Result.failure(IllegalStateException("Cannot scroll forward"))
            }
            "SCROLL_BACKWARD" -> {
                val node = root?.findFocus(AccessibilityNodeInfo.FOCUS_INPUT) ?: root
                val scrolled = node?.performAction(AccessibilityNodeInfo.ACTION_SCROLL_BACKWARD) ?: false
                if (scrolled) Result.success("Scrolled backward") else Result.failure(IllegalStateException("Cannot scroll backward"))
            }
            else -> Result.failure(UnsupportedOperationException("Unsupported action type: $actionType"))
        }
    }

    private fun findTargetNode(root: AccessibilityNodeInfo?, targetViewId: String?, targetText: String?): AccessibilityNodeInfo? {
        if (root == null) return null

        if (!targetViewId.isNullOrBlank()) {
            val nodes = root.findAccessibilityNodeInfosByViewId(targetViewId)
            if (nodes.isNotEmpty()) return nodes[0]
        }

        if (!targetText.isNullOrBlank()) {
            val nodes = root.findAccessibilityNodeInfosByText(targetText)
            if (nodes.isNotEmpty()) return nodes[0]
        }

        return null
    }

    private fun dispatchClickGesture(x: Float, y: Float): Result<String> {
        val clickPath = Path().apply {
            moveTo(x, y)
            lineTo(x, y)
        }
        val stroke = GestureDescription.StrokeDescription(clickPath, 0, 50)
        val gesture = GestureDescription.Builder().addStroke(stroke).build()

        val dispatched = dispatchGesture(gesture, null, null)
        return if (dispatched) {
            Result.success("Dispatched touch tap at ($x, $y)")
        } else {
            Result.failure(IllegalStateException("Failed dispatching gesture at ($x, $y)"))
        }
    }
}
