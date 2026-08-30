package polaris.iminprinter

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Build
import android.util.Base64
import com.imin.printer.INeoPrinterCallback
import com.imin.printer.PrinterHelper
import com.imin.printerlib.IminPrintUtils
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.Promise
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * The receipt printer in the iMin terminal.
 *
 * iMin ships two incompatible printer SDKs and which one a given terminal
 * answers on is a property of the unit, not of the Android version — the
 * vendor's own React Native module guesses from `Build.MODEL` in one place and
 * from the OS release in another, and disagrees with itself. So this module
 * does not guess. It brings both up, asks each for a status code, and keeps
 * whichever one actually answers. `getStatus()` reports which won, so a
 * failure to print is never ambiguous about who was driving.
 *
 *   NEO  — binds the com.imin.printerservice system service over AIDL
 *   SPI  — com.imin.printerlib talking to the head directly
 */
class IminPrinterModule : Module() {

  private enum class Generation { NONE, NEO, LEGACY }

  private var generation = Generation.NONE
  private var legacy: IminPrintUtils? = null
  private var initialised = false

  // The printer is a single physical resource: two concurrent print jobs
  // interleave their bytes on the same roll. Every call that emits bytes
  // holds this.
  private val head = Any()

  private val context
    get() = requireNotNull(appContext.reactContext) { "no react context" }

  private fun statusText(code: Int) = when (code) {
    0 -> "ready"
    1 -> "not connected or not powered on"
    3 -> "printer door is open"
    4 -> "cutter not reset"
    5 -> "print head overheated"
    6 -> "black label error"
    7 -> "out of paper"
    8 -> "paper is running out"
    99 -> "other error"
    else -> "initialisation failed (code $code)"
  }

  /** A status code the printer could plausibly have produced. */
  private fun isAnswer(code: Int) = code in intArrayOf(0, 3, 4, 5, 6, 7, 8)

  private fun bringUp() {
    if (initialised) return
    initialised = true

    // Generation 2. initPrinterService binds a system service, so the first
    // status read after it can beat the binding; poll rather than sleep once.
    runCatching {
      PrinterHelper.getInstance().initPrinterService(context)
      PrinterHelper.getInstance().initPrinter(context.packageName, null)
      repeat(20) {
        val code = runCatching { PrinterHelper.getInstance().getPrinterStatus() }.getOrDefault(-1)
        if (isAnswer(code)) {
          generation = Generation.NEO
          return
        }
        Thread.sleep(100)
      }
    }

    // Generation 1. SPI on the M2 family, USB on everything else — this split
    // is the vendor's and is load-bearing; the wrong transport reports -1.
    runCatching {
      val utils = IminPrintUtils.getInstance(context)
      val model = Build.MODEL ?: ""
      val transport =
        if (model.contains("M2-203") || model.contains("M2-202") || model.contains("M2-Pro"))
          IminPrintUtils.PrintConnectType.SPI
        else IminPrintUtils.PrintConnectType.USB
      utils.resetDevice()
      utils.initPrinter(transport)
      repeat(20) {
        val code = runCatching { utils.getPrinterStatus() }.getOrDefault(-1)
        if (isAnswer(code)) {
          legacy = utils
          generation = Generation.LEGACY
          return
        }
        Thread.sleep(100)
      }
    }
  }

  private fun status(): Int = when (generation) {
    Generation.NEO -> runCatching { PrinterHelper.getInstance().getPrinterStatus() }.getOrDefault(-1)
    Generation.LEGACY -> runCatching { legacy!!.getPrinterStatus() }.getOrDefault(-1)
    Generation.NONE -> -1
  }

  /**
   * Generation 2 reports completion on a callback. Print calls are queued on
   * the head anyway, so waiting here keeps "printed" honest: the promise
   * resolves when the bytes are out, not when they were accepted.
   */
  /**
   * Generation 2 answers on a callback, so waiting here keeps "printed" honest:
   * the promise resolves when the head has finished, not when it accepted the
   * bytes.
   *
   * Only `onRaiseException` and `onRunResult(false)` mean the job failed. This
   * printer also emits `onPrintResult(1, null)` on jobs that physically print
   * — verified against the head's own paper-distance counter, which advances
   * across exactly those calls — so a non-zero print result is recorded and
   * reported, never treated as an error.
   */
  private fun awaitNeo(block: (INeoPrinterCallback) -> Unit): String? {
    val latch = CountDownLatch(1)
    var failure: String? = null
    var returned: String? = null
    block(object : INeoPrinterCallback() {
      override fun onRunResult(isSuccess: Boolean) {
        if (!isSuccess) failure = "the printer reported the job failed"
        latch.countDown()
      }
      override fun onReturnString(result: String?) {
        returned = result
        latch.countDown()
      }
      override fun onRaiseException(code: Int, msg: String?) {
        failure = "the printer raised $code: ${msg ?: "no detail"}"
        latch.countDown()
      }
      override fun onPrintResult(code: Int, msg: String?) {
        lastPrintResult = code
        latch.countDown()
      }
    })
    if (!latch.await(15, TimeUnit.SECONDS)) throw IllegalStateException("the printer did not answer within 15s")
    failure?.let { throw IllegalStateException(it) }
    return returned
  }

  /** Last value the head reported through onPrintResult, for diagnostics. */
  @Volatile private var lastPrintResult: Int = -1

  /** True between beginDocument and endDocument. */
  @Volatile private var buffering = false

  private fun sink() = object : INeoPrinterCallback() {
    override fun onRunResult(isSuccess: Boolean) {}
    override fun onReturnString(result: String?) {}
    override fun onRaiseException(code: Int, msg: String?) {}
    override fun onPrintResult(code: Int, msg: String?) { lastPrintResult = code }
  }

  /**
   * Inside a buffered document the service accumulates and answers nothing
   * until the commit, so waiting per call deadlocks. Outside one, every call
   * is its own job and is waited on.
   */
  private fun emitNeo(block: (INeoPrinterCallback) -> Unit) {
    if (buffering) block(sink()) else awaitNeo(block)
  }

  override fun definition() = ModuleDefinition {
    Name("IminPrinter")

    AsyncFunction("getStatus") { promise: Promise ->
      synchronized(head) {
        bringUp()
        val code = status()
        promise.resolve(mapOf(
          "generation" to generation.name,
          "model" to (Build.MODEL ?: "unknown"),
          "manufacturer" to (Build.MANUFACTURER ?: "unknown"),
          "code" to code,
          "text" to statusText(code),
          "ready" to (code == 0)
        ))
      }
    }

    AsyncFunction("printText") { text: String, size: Int, align: Int, bold: Boolean, promise: Promise ->
      synchronized(head) {
        bringUp()
        when (generation) {
          Generation.NEO -> {
            // printText on this generation ignores size and weight entirely;
            // only the bitmap path honours them, so all receipt text goes
            // through it and a heading is actually a heading on the paper.
            PrinterHelper.getInstance().setTextBitmapSize(size)
            PrinterHelper.getInstance().setTextBitmapStyle(if (bold) 1 else 0)
            emitNeo { cb -> PrinterHelper.getInstance().printTextBitmapWithAli(text + "\n", align, cb) }
          }
          Generation.LEGACY -> legacy!!.let {
            it.setTextSize(size)
            it.setAlignment(align)
            it.setTextStyle(if (bold) 1 else 0)
            it.printText(text + "\n")
          }
          Generation.NONE -> throw IllegalStateException("no printer: ${statusText(status())}")
        }
        promise.resolve(null)
      }
    }

    /*
     * One line in the head's built-in font.
     *
     * This exists because printColumnsText measures its column widths in
     * characters *at the default font size*, and silently rescales them
     * against whatever size is passed alongside. Asking for a 12-character
     * column at size 28 yields about two characters, and a receipt printed
     * that way comes out one letter per line, vertically. Callers pad to 32
     * columns themselves and print the finished line here instead.
     */
    AsyncFunction("printMono") { text: String, align: Int, promise: Promise ->
      synchronized(head) {
        bringUp()
        when (generation) {
          Generation.NEO -> emitNeo { cb -> PrinterHelper.getInstance().printTextWithAli(text + "\n", align, cb) }
          Generation.LEGACY -> legacy!!.let {
            it.setTextSize(24)
            it.setAlignment(align)
            it.setTextStyle(0)
            it.printText(text + "\n")
          }
          Generation.NONE -> throw IllegalStateException("no printer: ${statusText(status())}")
        }
        promise.resolve(null)
      }
    }

    // Kept for callers that want the head's own column engine at its default
    // size. The receipt does not use it; see printMono.
    AsyncFunction("printColumns") { texts: List<String>, widths: List<Int>, aligns: List<Int>, size: Int, promise: Promise ->
      synchronized(head) {
        bringUp()
        val t = texts.toTypedArray()
        val w = widths.toIntArray()
        val a = aligns.toIntArray()
        val s = IntArray(texts.size) { size }
        when (generation) {
          Generation.NEO -> emitNeo { cb -> PrinterHelper.getInstance().printColumnsText(t, w, a, s, cb) }
          Generation.LEGACY -> legacy!!.printColumnsText(t, w, a, s)
          Generation.NONE -> throw IllegalStateException("no printer: ${statusText(status())}")
        }
        promise.resolve(null)
      }
    }

    AsyncFunction("printQrCode") { data: String, size: Int, align: Int, promise: Promise ->
      synchronized(head) {
        bringUp()
        when (generation) {
          Generation.NEO -> {
            PrinterHelper.getInstance().setQrCodeSize(size)
            PrinterHelper.getInstance().setQrCodeErrorCorrectionLev(3)
            emitNeo { cb -> PrinterHelper.getInstance().printQrCodeWithAlign(data, align, cb) }
          }
          Generation.LEGACY -> legacy!!.let {
            it.setQrCodeSize(size)
            it.setQrCodeErrorCorrectionLev(3)
            it.printQrCode(data, align)
          }
          Generation.NONE -> throw IllegalStateException("no printer: ${statusText(status())}")
        }
        promise.resolve(null)
      }
    }

    AsyncFunction("printBitmap") { base64: String, align: Int, promise: Promise ->
      synchronized(head) {
        bringUp()
        val raw = Base64.decode(base64, Base64.DEFAULT)
        val bitmap: Bitmap = BitmapFactory.decodeByteArray(raw, 0, raw.size)
          ?: throw IllegalArgumentException("could not decode that image")
        when (generation) {
          Generation.NEO -> emitNeo { cb -> PrinterHelper.getInstance().printBitmapWithAlign(bitmap, align, cb) }
          Generation.LEGACY -> legacy!!.printSingleBitmap(bitmap, align)
          Generation.NONE -> throw IllegalStateException("no printer: ${statusText(status())}")
        }
        promise.resolve(null)
      }
    }

    /*
     * A receipt is one document, not twenty independent jobs. Without the
     * buffer each call races the head and content is dropped — a first
     * attempt at this receipt fed 33mm of paper for a job that should feed
     * roughly four times that. Between beginDocument and endDocument the
     * service accumulates and then commits in one pass.
     */
    AsyncFunction("beginDocument") { promise: Promise ->
      synchronized(head) {
        bringUp()
        if (generation == Generation.NEO) {
          PrinterHelper.getInstance().enterPrinterBuffer(true)
          buffering = true
        }
        promise.resolve(null)
      }
    }

    AsyncFunction("endDocument") { promise: Promise ->
      synchronized(head) {
        if (generation == Generation.NEO) {
          // The commit is the job: this is the one call worth waiting on, and
          // it is where a real failure surfaces.
          buffering = false
          runCatching { awaitNeo { cb -> PrinterHelper.getInstance().commitPrinterBuffer(cb) } }
          PrinterHelper.getInstance().exitPrinterBuffer(true)
        }
        promise.resolve(null)
      }
    }

    // The head's own counters. paperDistance advances with every millimetre
    // that physically leaves the printer, so it is the one available way to
    // confirm a job reached paper rather than merely being accepted.
    AsyncFunction("hardware") { promise: Promise ->
      synchronized(head) {
        bringUp()
        if (generation != Generation.NEO) {
          promise.resolve(mapOf("generation" to generation.name, "supported" to false))
          return@AsyncFunction
        }
        val h = PrinterHelper.getInstance()
        promise.resolve(mapOf(
          "generation" to generation.name,
          "supported" to true,
          "serialNumber" to runCatching { awaitNeo { cb -> h.getPrinterSerialNumber(cb) } }.getOrNull(),
          "modelName" to runCatching { awaitNeo { cb -> h.getPrinterModelName(cb) } }.getOrNull(),
          "firmware" to runCatching { awaitNeo { cb -> h.getPrinterFirmwareVersion(cb) } }.getOrNull(),
          "paperDistance" to runCatching { awaitNeo { cb -> h.getPrinterPaperDistance(cb) } }.getOrNull(),
          "cutTimes" to runCatching { awaitNeo { cb -> h.getPrinterCutTimes(cb) } }.getOrNull(),
          "lastPrintResult" to lastPrintResult
        ))
      }
    }

    AsyncFunction("feedAndCut") { lines: Int, promise: Promise ->
      synchronized(head) {
        bringUp()
        when (generation) {
          Generation.NEO -> {
            PrinterHelper.getInstance().printAndFeedPaper(lines * 24)
            PrinterHelper.getInstance().partialCut()
          }
          Generation.LEGACY -> legacy!!.let {
            it.printAndFeedPaper(lines * 24)
            it.partialCut()
          }
          Generation.NONE -> throw IllegalStateException("no printer: ${statusText(status())}")
        }
        promise.resolve(null)
      }
    }
  }
}
