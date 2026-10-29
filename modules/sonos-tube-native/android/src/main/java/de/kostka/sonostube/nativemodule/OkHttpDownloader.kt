package de.kostka.sonostube.nativemodule

import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody
import org.schabi.newpipe.extractor.downloader.Downloader
import org.schabi.newpipe.extractor.downloader.Request
import org.schabi.newpipe.extractor.downloader.Response
import org.schabi.newpipe.extractor.exceptions.ReCaptchaException
import java.util.concurrent.TimeUnit

/**
 * NewPipe [Downloader] backed by OkHttp, modelled on NewPipe's DownloaderImpl.
 */
class OkHttpDownloader private constructor(val client: OkHttpClient) : Downloader() {

  override fun execute(request: Request): Response {
    val httpMethod = request.httpMethod()
    val url = request.url()
    val headers = request.headers()
    val dataToSend = request.dataToSend()

    val body = dataToSend?.toRequestBody(null)

    val builder = okhttp3.Request.Builder()
      .method(httpMethod, body)
      .url(url)
      .addHeader("User-Agent", USER_AGENT)

    for ((name, values) in headers) {
      builder.removeHeader(name)
      for (value in values) builder.addHeader(name, value)
    }

    client.newCall(builder.build()).execute().use { response ->
      if (response.code == 429) {
        throw ReCaptchaException("reCaptcha Challenge requested", url)
      }
      val responseBody = response.body?.string()
      val latestUrl = response.request.url.toString()
      return Response(
        response.code,
        response.message,
        response.headers.toMultimap(),
        responseBody,
        latestUrl
      )
    }
  }

  companion object {
    /** Same desktop Firefox UA NewPipe uses for its extraction requests. */
    const val USER_AGENT =
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0"

    @Volatile
    private var instance: OkHttpDownloader? = null

    fun get(): OkHttpDownloader = instance ?: synchronized(this) {
      instance ?: OkHttpDownloader(
        OkHttpClient.Builder()
          .connectTimeout(15, TimeUnit.SECONDS)
          .readTimeout(30, TimeUnit.SECONDS)
          .build()
      ).also { instance = it }
    }
  }
}
