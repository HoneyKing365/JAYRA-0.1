package ai.jayra.companion.service

import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import ai.jayra.companion.model.InstalledAppInfo
import java.util.Locale

class AppLaunchManager(private val context: Context) {

    private val packageManager: PackageManager = context.packageManager

    /**
     * Discovers all launchable applications installed on this Android device dynamically.
     * Completely unconstrained; includes user-installed, system utilities, games, and browsers.
     */
    fun listInstalledApps(): List<InstalledAppInfo> {
        val intent = Intent(Intent.ACTION_MAIN, null).apply {
            addCategory(Intent.CATEGORY_LAUNCHER)
        }
        val resolveInfoList = packageManager.queryIntentActivities(intent, 0)
        val appList = mutableListOf<InstalledAppInfo>()

        for (resolveInfo in resolveInfoList) {
            val appInfo = resolveInfo.activityInfo.applicationInfo
            val appName = resolveInfo.loadLabel(packageManager).toString()
            val packageName = resolveInfo.activityInfo.packageName
            val isSystem = (appInfo.flags and ApplicationInfo.FLAG_SYSTEM) != 0

            appList.add(
                InstalledAppInfo(
                    name = appName,
                    packageName = packageName,
                    isSystem = isSystem
                )
            )
        }

        return appList.sortedBy { it.name.lowercase(Locale.ROOT) }
    }

    /**
     * Dynamically launches ANY application requested by the desktop Gyra engine.
     * Matches against package name, exact display name, or fuzzy keyword.
     */
    fun launchApp(query: String, explicitPackage: String? = null): Result<String> {
        val cleanQuery = query.trim().lowercase(Locale.ROOT)

        // 1. Try explicit package name if provided
        if (!explicitPackage.isNullOrBlank()) {
            val intent = packageManager.getLaunchIntentForPackage(explicitPackage)
            if (intent != null) {
                intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                context.startActivity(intent)
                return Result.success("Launched explicit package: $explicitPackage")
            }
        }

        // 2. Discover all installed apps
        val apps = listInstalledApps()

        // 3. Match exact package name
        val exactPackageMatch = apps.find { it.packageName.equals(cleanQuery, ignoreCase = true) }
        if (exactPackageMatch != null) {
            return startApp(exactPackageMatch.packageName, exactPackageMatch.name)
        }

        // 4. Match exact display name (e.g. "YouTube", "Instagram", "Settings")
        val exactNameMatch = apps.find { it.name.equals(cleanQuery, ignoreCase = true) }
        if (exactNameMatch != null) {
            return startApp(exactNameMatch.packageName, exactNameMatch.name)
        }

        // 5. Match substring / fuzzy keyword (e.g. "insta" -> Instagram, "play" -> Google Play Store)
        val fuzzyMatch = apps.find {
            it.name.lowercase(Locale.ROOT).contains(cleanQuery) ||
            it.packageName.lowercase(Locale.ROOT).contains(cleanQuery)
        }
        if (fuzzyMatch != null) {
            return startApp(fuzzyMatch.packageName, fuzzyMatch.name)
        }

        return Result.failure(
            IllegalArgumentException("No installed application found matching '$query'. Available: ${apps.size} apps.")
        )
    }

    private fun startApp(packageName: String, appName: String): Result<String> {
        val launchIntent = packageManager.getLaunchIntentForPackage(packageName)
            ?: return Result.failure(IllegalStateException("No launchable intent found for package: $packageName"))

        launchIntent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_RESET_TASK_IF_NEEDED)
        context.startActivity(launchIntent)
        return Result.success("Successfully launched $appName ($packageName)")
    }
}
