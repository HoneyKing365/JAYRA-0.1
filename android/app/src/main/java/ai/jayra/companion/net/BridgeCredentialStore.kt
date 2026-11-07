package ai.jayra.companion.net

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Base64
import java.security.GeneralSecurityException
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

data class StoredBridgeCredentials(
    val host: String,
    val port: Int,
    val token: String
)

class BridgeCredentialStore(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences(
        "jayra_mobile_bridge_credentials",
        Context.MODE_PRIVATE
    )

    fun load(): StoredBridgeCredentials? {
        val encryptedToken = preferences.getString(TOKEN_KEY, null) ?: return null
        val host = preferences.getString(HOST_KEY, null)
            ?: throw GeneralSecurityException("Saved JAYRA pairing is missing its host.")
        val port = preferences.getInt(PORT_KEY, 0)
        if (port !in 1..65_535) throw GeneralSecurityException("Saved JAYRA pairing has an invalid port.")

        val stored = Base64.decode(encryptedToken, Base64.NO_WRAP)
        if (stored.size <= IV_LENGTH) throw GeneralSecurityException("Saved JAYRA bridge credential is invalid.")
        val iv = stored.copyOfRange(0, IV_LENGTH)
        val ciphertext = stored.copyOfRange(IV_LENGTH, stored.size)
        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.DECRYPT_MODE, getOrCreateKey(), GCMParameterSpec(TAG_LENGTH_BITS, iv))
        val token = String(cipher.doFinal(ciphertext), Charsets.UTF_8)
        if (!TOKEN_PATTERN.matches(token)) throw GeneralSecurityException("Saved JAYRA bridge token is invalid.")
        return StoredBridgeCredentials(host, port, token)
    }

    fun save(host: String, port: Int, token: String) {
        require(host.isNotBlank()) { "A host is required to save JAYRA pairing." }
        require(port in 1..65_535) { "The JAYRA pairing port is invalid." }
        require(TOKEN_PATTERN.matches(token)) { "The JAYRA bridge token is invalid." }

        val cipher = Cipher.getInstance("AES/GCM/NoPadding")
        cipher.init(Cipher.ENCRYPT_MODE, getOrCreateKey())
        val encryptedToken = cipher.iv + cipher.doFinal(token.toByteArray(Charsets.UTF_8))
        val saved = preferences.edit()
            .putString(HOST_KEY, host)
            .putInt(PORT_KEY, port)
            .putString(TOKEN_KEY, Base64.encodeToString(encryptedToken, Base64.NO_WRAP))
            .commit()
        if (!saved) throw IllegalStateException("Could not save JAYRA mobile pairing credentials.")
    }

    private fun getOrCreateKey(): SecretKey {
        val keyStore = KeyStore.getInstance(ANDROID_KEY_STORE).apply { load(null) }
        (keyStore.getKey(KEY_ALIAS, null) as? SecretKey)?.let { return it }

        val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEY_STORE)
        generator.init(
            KeyGenParameterSpec.Builder(
                KEY_ALIAS,
                KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
            )
                .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                .setRandomizedEncryptionRequired(true)
                .build()
        )
        return generator.generateKey()
    }

    private companion object {
        const val ANDROID_KEY_STORE = "AndroidKeyStore"
        const val KEY_ALIAS = "jayra_mobile_bridge_token_v1"
        const val TOKEN_KEY = "encrypted_bridge_token"
        const val HOST_KEY = "host"
        const val PORT_KEY = "port"
        const val IV_LENGTH = 12
        const val TAG_LENGTH_BITS = 128
        val TOKEN_PATTERN = Regex("[a-fA-F0-9]{64}")
    }
}
