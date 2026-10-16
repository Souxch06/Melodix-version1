package expo.modules.melodixmedia

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.media.AudioManager

/**
 * Récepteur système « casque/Bluetooth débranché » (§11).
 *
 * Android diffuse `ACTION_AUDIO_BECOMING_NOISY` quand la sortie audio
 * disparaît : casque filaire débranché, casque Bluetooth éteint ou hors de
 * portée. L'application ne doit alors JAMAIS continuer à jouer dans le
 * haut-parleur du téléphone : elle met la lecture en pause.
 *
 * Ce récepteur ne décide RIEN : il se contente de notifier (`onNoisyAudio`).
 * Le module transmet l'événement au JS, et c'est `melodixPlayer` — source de
 * vérité unique — qui met en pause, exactement comme pour une commande
 * système. Aucune seconde logique de lecture n'existe côté natif.
 *
 * Testable en isolation (Robolectric) : la notification est injectée.
 */
class MelodixNoisyAudioReceiver(
  private val onNoisyAudio: () -> Unit
) : BroadcastReceiver() {

  override fun onReceive(context: Context?, intent: Intent?) {
    if (intent?.action != AudioManager.ACTION_AUDIO_BECOMING_NOISY) {
      return
    }

    try {
      onNoisyAudio()
    } catch (t: Throwable) {
      // Une couche de signalement ne fait jamais planter l'application :
      // l'audio reste la priorité absolue.
      MelodixDiagLog.error("NOISY_AUDIO_CALLBACK_FAIL", t)
    }
  }
}
