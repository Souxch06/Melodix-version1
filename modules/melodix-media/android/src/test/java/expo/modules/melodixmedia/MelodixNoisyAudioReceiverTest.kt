package expo.modules.melodixmedia

import android.content.Context
import android.content.Intent
import android.media.AudioManager
import org.junit.Assert.assertEquals
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.RuntimeEnvironment
import org.robolectric.annotation.Config

/**
 * §11 — casque/Bluetooth débranché : le récepteur doit relayer EXACTEMENT
 * l'événement système, ignorer tout autre broadcast, et ne jamais propager
 * une exception (l'audio reste prioritaire).
 */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [34])
class MelodixNoisyAudioReceiverTest {

  private val context: Context = RuntimeEnvironment.getApplication()
  private var notifications = 0

  private fun receiver() = MelodixNoisyAudioReceiver { notifications += 1 }

  @Test
  fun `le debranchement audio notifie une seule fois`() {
    val receiver = receiver()

    receiver.onReceive(context, Intent(AudioManager.ACTION_AUDIO_BECOMING_NOISY))

    assertEquals(1, notifications)
  }

  @Test
  fun `un autre broadcast est ignore`() {
    val receiver = receiver()

    receiver.onReceive(context, Intent(Intent.ACTION_SCREEN_ON))
    receiver.onReceive(context, Intent())

    assertEquals(0, notifications)
  }

  @Test
  fun `intent absent ignore sans planter`() {
    val receiver = receiver()

    receiver.onReceive(context, null)

    assertEquals(0, notifications)
  }

  @Test
  fun `une erreur de notification ne remonte jamais`() {
    val failing = MelodixNoisyAudioReceiver { throw IllegalStateException("boom") }

    failing.onReceive(context, Intent(AudioManager.ACTION_AUDIO_BECOMING_NOISY))

    // Parvenir ici prouve que l'exception a été absorbée côté natif.
    assertEquals(0, notifications)
  }
}
