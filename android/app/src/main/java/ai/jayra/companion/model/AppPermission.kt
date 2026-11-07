package ai.jayra.companion.model

data class AppPermissionItem(
    val id: String,
    val title: String,
    val description: String,
    val isGranted: Boolean,
    val isRequired: Boolean = true,
    val manifestPermission: String? = null,
    val isAccessibilityService: Boolean = false
)
