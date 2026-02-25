package ai.skynet.android.protocol

import org.junit.Assert.assertEquals
import org.junit.Test

class SkynetProtocolConstantsTest {
  @Test
  fun canvasCommandsUseStableStrings() {
    assertEquals("canvas.present", SkynetCanvasCommand.Present.rawValue)
    assertEquals("canvas.hide", SkynetCanvasCommand.Hide.rawValue)
    assertEquals("canvas.navigate", SkynetCanvasCommand.Navigate.rawValue)
    assertEquals("canvas.eval", SkynetCanvasCommand.Eval.rawValue)
    assertEquals("canvas.snapshot", SkynetCanvasCommand.Snapshot.rawValue)
  }

  @Test
  fun a2uiCommandsUseStableStrings() {
    assertEquals("canvas.a2ui.push", SkynetCanvasA2UICommand.Push.rawValue)
    assertEquals("canvas.a2ui.pushJSONL", SkynetCanvasA2UICommand.PushJSONL.rawValue)
    assertEquals("canvas.a2ui.reset", SkynetCanvasA2UICommand.Reset.rawValue)
  }

  @Test
  fun capabilitiesUseStableStrings() {
    assertEquals("canvas", SkynetCapability.Canvas.rawValue)
    assertEquals("camera", SkynetCapability.Camera.rawValue)
    assertEquals("screen", SkynetCapability.Screen.rawValue)
    assertEquals("voiceWake", SkynetCapability.VoiceWake.rawValue)
  }

  @Test
  fun screenCommandsUseStableStrings() {
    assertEquals("screen.record", SkynetScreenCommand.Record.rawValue)
  }
}
