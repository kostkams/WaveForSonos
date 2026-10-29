package de.kostka.sonostube.nativemodule

import android.content.Context
import android.content.Intent
import android.content.res.AssetFileDescriptor
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Base64
import android.util.Log
import java.io.File
import java.io.FileInputStream
import java.io.InputStream
import java.security.MessageDigest

/**
 * Local audio files picked by the user (Storage Access Framework).
 *
 * The id of a local track is the content URI itself, base64url-encoded, so the proxy can serve it
 * statelessly (`/local/<id>.<ext>`) and saved playlists keep working after a restart – the read
 * permission is persisted when the file is picked.
 */
object LocalAudio {
  private const val TAG = "SonosTubeLocal"

  @Volatile
  private var appContext: Context? = null

  fun init(context: Context) {
    if (appContext == null) appContext = context.applicationContext
  }

  private val context: Context
    get() = requireNotNull(appContext) { "LocalAudio not initialised" }

  fun encodeId(uri: String): String =
    Base64.encodeToString(uri.toByteArray(Charsets.UTF_8), Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)

  fun decodeId(id: String): Uri? = try {
    Uri.parse(String(Base64.decode(id, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP), Charsets.UTF_8))
  } catch (e: IllegalArgumentException) {
    null
  }

  /** URIs picked by the user in this process (covers picks whose permission could not be persisted). */
  private val pickedUris = java.util.concurrent.ConcurrentHashMap.newKeySet<String>()

  /**
   * Whether the proxy may serve [uri]: only content URIs the user picked – in this process or with
   * a persisted read grant. Anything else (file://, other providers' URIs) is refused, since the
   * proxy is reachable from the whole LAN without authentication.
   */
  fun isServable(uri: Uri): Boolean {
    if (uri.scheme?.lowercase() != "content") return false
    val s = uri.toString()
    if (s in pickedUris) return true
    return try {
      context.contentResolver.persistedUriPermissions.any { it.isReadPermission && it.uri.toString() == s }
    } catch (e: Exception) {
      false
    }
  }

  /** Keeps read access across restarts (only possible for ACTION_OPEN_DOCUMENT URIs). */
  fun persistPermission(uri: Uri) {
    pickedUris.add(uri.toString())
    try {
      context.contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION)
    } catch (e: SecurityException) {
      Log.w(TAG, "Could not persist permission for $uri", e)
    }
  }

  /** File extension Sonos understands, from the MIME type or the file name. */
  fun extensionFor(mime: String?, name: String?): String {
    val fromName = name?.substringAfterLast('.', "")?.lowercase()?.takeIf { it.length in 2..5 }
    return when (mime?.lowercase()) {
      "audio/mpeg", "audio/mp3" -> "mp3"
      "audio/mp4", "audio/m4a", "audio/x-m4a", "audio/aac", "audio/aacp" -> if (fromName == "aac") "aac" else "m4a"
      "audio/flac", "audio/x-flac" -> "flac"
      "audio/wav", "audio/x-wav", "audio/wave" -> "wav"
      "audio/ogg", "application/ogg", "audio/vorbis" -> "ogg"
      "audio/x-ms-wma" -> "wma"
      else -> fromName ?: "mp3"
    }
  }

  fun mimeForExtension(ext: String): String = when (ext.lowercase()) {
    "mp3" -> "audio/mpeg"
    "m4a" -> "audio/mp4"
    "aac" -> "audio/aac"
    "flac" -> "audio/flac"
    "wav" -> "audio/wav"
    "ogg" -> "audio/ogg"
    "wma" -> "audio/x-ms-wma"
    else -> "application/octet-stream"
  }

  /** Reads title/artist/duration/cover of a picked file into the MediaItem shape used by JS. */
  fun describe(uri: Uri): Map<String, Any?> {
    val resolver = context.contentResolver
    var displayName: String? = null
    var size: Long? = null
    try {
      resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c ->
        if (c.moveToFirst()) {
          displayName = c.getString(0)
          if (!c.isNull(1)) size = c.getLong(1)
        }
      }
    } catch (e: Exception) {
      Log.w(TAG, "query failed for $uri", e)
    }
    val mime = resolver.getType(uri)
    val ext = extensionFor(mime, displayName)

    var title: String? = null
    var artist: String? = null
    var album: String? = null
    var durationSec: Double? = null
    var thumbnail: String? = null
    val retriever = MediaMetadataRetriever()
    try {
      retriever.setDataSource(context, uri)
      title = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_TITLE)?.trim()?.takeIf { it.isNotEmpty() }
      artist = (retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ARTIST)
        ?: retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUMARTIST))?.trim()?.takeIf { it.isNotEmpty() }
      album = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_ALBUM)?.trim()?.takeIf { it.isNotEmpty() }
      durationSec = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()?.let { it / 1000.0 }
      retriever.embeddedPicture?.let { bytes -> thumbnail = saveArt(uri.toString(), bytes) }
    } catch (e: Exception) {
      Log.w(TAG, "metadata failed for $uri", e)
    } finally {
      try {
        retriever.release()
      } catch (_: Exception) {
      }
    }

    val fallbackTitle = displayName?.substringBeforeLast('.')?.takeIf { it.isNotBlank() } ?: "Audio"
    return mapOf(
      "type" to "local",
      "id" to encodeId(uri.toString()),
      "title" to (title ?: fallbackTitle),
      "channel" to (artist ?: album ?: ""),
      "durationSec" to durationSec,
      "thumbnail" to thumbnail,
      "viewCount" to null,
      "videoCount" to null,
      "url" to uri.toString(),
      "ext" to ext,
      "sizeBytes" to size?.toDouble()
    )
  }

  // region cover art

  private val artDir: File
    get() = File(context.filesDir, "local-art").apply { mkdirs() }

  private fun artName(key: String): String {
    val digest = MessageDigest.getInstance("SHA-1").digest(key.toByteArray(Charsets.UTF_8))
    return digest.joinToString("") { "%02x".format(it) } + ".jpg"
  }

  /** Stores embedded cover art and returns a file:// URI for the app UI. */
  private fun saveArt(key: String, bytes: ByteArray): String {
    val file = File(artDir, artName(key))
    if (!file.exists()) file.writeBytes(bytes)
    return Uri.fromFile(file).toString()
  }

  /** Cover file by name (for the proxy's /local-art/<name> route), or null. */
  fun artFile(name: String): File? {
    if (!ART_NAME.matches(name)) return null
    return File(artDir, name).takeIf { it.isFile }
  }

  private val ART_NAME = Regex("^[0-9a-f]{40}\\.jpg$")

  // endregion

  // region streaming

  class Opened(val stream: InputStream, val length: Long, private val afd: AssetFileDescriptor) : AutoCloseable {
    override fun close() {
      try {
        stream.close()
      } catch (_: Exception) {
      }
      try {
        afd.close()
      } catch (_: Exception) {
      }
    }
  }

  /** Opens the file positioned at [start]. Length is -1 when the provider doesn't know it. */
  fun open(uri: Uri, start: Long): Opened {
    val afd = context.contentResolver.openAssetFileDescriptor(uri, "r")
      ?: throw java.io.FileNotFoundException("Cannot open $uri")
    var input: FileInputStream? = null
    try {
      val length = afd.length.takeIf { it >= 0 } ?: afd.parcelFileDescriptor?.statSize?.takeIf { it >= 0 } ?: -1L
      input = FileInputStream(afd.fileDescriptor)
      // AssetFileDescriptor may point into a bigger file; seek to its start + requested offset.
      // (Skipped at 0 so non-seekable pipe descriptors still work for full reads.)
      val target = afd.startOffset + start
      if (target != 0L) input.channel.position(target)
      return Opened(input, length, afd)
    } catch (e: Exception) {
      try {
        input?.close()
      } catch (_: Exception) {
      }
      try {
        afd.close()
      } catch (_: Exception) {
      }
      throw e
    }
  }

  // endregion
}
