package expo.modules.melodixmedia

import android.Manifest
import android.app.NotificationManager
import android.content.Context
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import androidx.core.app.ActivityCompat
import androidx.core.content.ContextCompat
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Module natif MelodixMedia (phase 5A) — couche de CONTRÔLE MediaSession.
 *
 * Ce module :
 *  - NE JOUE AUCUN AUDIO : le moteur reste `melodixPlayer` (expo-av) ;
 *  - ne connaît AUCUNE URL de flux (Audius/YouTube) ;
 *  - ne possède AUCUNE file, shuffle ou repeat ;
 *  - projette l'état reçu du JS vers la MediaSession Android
 *    et re-transmet les commandes système vers le JS.
 */
class MelodixMediaModule : Module() {

  private val mainHandler = Handler(Looper.getMainLooper())
  private var permissionPollGeneration = 0
  private var applicationContext: Context? = null

  /** Récepteur « casque débranché » (enregistré tant que l'app vit). */
  private var noisyAudioReceiver: MelodixNoisyAudioReceiver? = null

  /**
   * §11 — casque filaire débranché / Bluetooth perdu : Android diffuse
   * ACTION_AUDIO_BECOMING_NOISY. On enregistre un récepteur DYNAMIQUE (aucune
   * permission, aucune entrée de manifeste, broadcast système uniquement) et
   * on remonte l'événement au JS. Le natif n'agit pas sur la lecture : le
   * moteur JS décide la pause, comme pour toute commande système.
   */
  private fun registerNoisyAudioReceiver(context: Context) {
    if (noisyAudioReceiver != null) return

    val receiver = MelodixNoisyAudioReceiver {
      MelodixDiagLog.step("AUDIO_BECOMING_NOISY", "relayedToJs=true")
      try {
        this@MelodixMediaModule.sendEvent("audioBecomingNoisy", emptyMap<String, Any>())
      } catch (t: Throwable) {
        MelodixDiagLog.error("AUDIO_BECOMING_NOISY_SEND_FAIL", t)
      }
    }

    try {
      ContextCompat.registerReceiver(
        context,
        receiver,
        IntentFilter(AudioManager.ACTION_AUDIO_BECOMING_NOISY),
        ContextCompat.RECEIVER_NOT_EXPORTED
      )
      noisyAudioReceiver = receiver
      MelodixDiagLog.step("NOISY_RECEIVER_REGISTERED")
    } catch (t: Throwable) {
      // Jamais bloquant : sans récepteur, l'application fonctionne comme avant.
      MelodixDiagLog.error("NOISY_RECEIVER_REGISTER_FAIL", t)
    }
  }

  private fun unregisterNoisyAudioReceiver(context: Context) {
    val receiver = noisyAudioReceiver ?: return
    noisyAudioReceiver = null

    try {
      context.unregisterReceiver(receiver)
      MelodixDiagLog.step("NOISY_RECEIVER_UNREGISTERED")
    } catch (t: Throwable) {
      MelodixDiagLog.error("NOISY_RECEIVER_UNREGISTER_FAIL", t)
    }
  }

  /**
   * ActivityCompat ne renvoie pas le résultat au Module Expo. On observe donc
   * brièvement l'état système après la boîte de dialogue. En cas d'accord,
   * la dernière projection est rejouée afin de republier la notification qui
   * a pu être créée avant que POST_NOTIFICATIONS ne soit accordée.
   */
  private fun observeNotificationPermissionResult(context: Context) {
    val generation = ++permissionPollGeneration
    var attempts = 0
    val check = object : Runnable {
      override fun run() {
        if (generation != permissionPollGeneration) return
        val granted =
          ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        if (granted) {
          MelodixDiagLog.step("NOTIFICATION_PERMISSION_RESULT", "granted=true")
          MelodixMediaController.refreshLastProjection(context)
          return
        }
        attempts += 1
        if (attempts < 60) {
          mainHandler.postDelayed(this, 500L)
        } else {
          MelodixDiagLog.step("NOTIFICATION_PERMISSION_RESULT", "granted=false timeout=true")
        }
      }
    }
    mainHandler.postDelayed(check, 500L)
  }

  companion object {
    private const val TAG = "MelodixMediaModule"

    /** Request code propre au module (évite les collisions d'activité RN). */
    private const val REQUEST_CODE_POST_NOTIFICATIONS = 0x4D58 // "MX"
  }

  /**
   * V37 — état du verrou de visibilité de la notification (aucune donnée
   * sensible : versions/booléens/importance). Cause démontrée du défaut
   * terrain « la notification n'apparaît pas » : sur Android 13+, sans
   * POST_NOTIFICATIONS accordée, la notification du foreground service est
   * masquée du tiroir (visible uniquement dans le gestionnaire de tâches
   * FGS). `channelImportance=0` (NONE) ou `notificationsActivees=false`
   * signalent un blocage dans les réglages système de l'appareil.
   */
  private fun notificationGateStatus(context: Context): String {
    val sdk = Build.VERSION.SDK_INT
    val manager =
      context.getSystemService(NotificationManager::class.java)
        ?: return "notificationGate=managerAbsent"
    val enabled =
      try {
        androidx.core.app.NotificationManagerCompat.from(context)
          .areNotificationsEnabled()
      } catch (t: Throwable) {
        null
      }
    val permissionGranted =
      if (sdk >= 33) {
        ContextCompat.checkSelfPermission(
          context,
          Manifest.permission.POST_NOTIFICATIONS
        ) == PackageManager.PERMISSION_GRANTED
      } else {
        true // la permission n'existe pas avant Android 13
      }
    val channelImportance =
      if (sdk >= 26) {
        manager.getNotificationChannel(
          MelodixMediaNotificationProvider.CHANNEL_ID
        )?.importance
      } else {
        null
      }
    val activeCount =
      if (sdk >= 23) manager.activeNotifications?.size ?: 0 else -1
    return "notificationGate=sdk$sdk permissionAccordee=$permissionGranted " +
      "notificationsActivees=$enabled channelImportance=$channelImportance " +
      "notificationsActives=$activeCount"
  }

  override fun definition() = ModuleDefinition {
    Name("MelodixMedia")

    Events("mediaCommand", "audioBecomingNoisy")

    OnCreate {
      // Retenir uniquement le contexte application : le ReactContext d'Expo
      // est une WeakReference et peut déjà avoir disparu à OnDestroy.
      applicationContext = appContext.reactContext?.applicationContext

      // §11 : casque débranché → pause. Enregistré dès que l'app vit, la
      // décision de pause restant entièrement côté moteur JS.
      applicationContext?.let { registerNoisyAudioReceiver(it) }

      // 4.4.7-diagnostic : journal persistant + piège d'exceptions non
      // rattrapées (tous threads) — critique pour le diagnostic sans ADB.
      applicationContext?.let { MelodixDiagLog.init(it) }
      MelodixDiagLog.installCrashTrap()
      MelodixDiagLog.step("MODULE_ONCREATE")

      // Le canal JS → natif arrive prêt : le service re-transmet les
      // commandes (notification/verrou/casque) vers le bridge JS.
      MelodixMediaController.commandListener = { command, positionMillis ->
        val payload = mutableMapOf<String, Any>("command" to command)

        if (positionMillis != null) {
          payload["positionMillis"] = positionMillis.toDouble()
        }

        this@MelodixMediaModule.sendEvent("mediaCommand", payload)
      }
    }

    // ------------------------------------------------------------------
    // DIAGNOSTIC 4.4.7 (temporaire) — journal persistant + drapeaux A/B/C.
    // AUCUN changement de comportement par défaut : tous les drapeaux sont
    // à false tant que l'UI Réglages ne les active pas.
    // ------------------------------------------------------------------

    /** Alimente les drapeaux d'isolation (A/B service, Test C sous-étapes). */
    Function("setDiagFlags") { flags: Map<String, Any?> ->
      try {
        MelodixDiagLog.Flags.apply(flags)
      } catch (t: Throwable) {
        android.util.Log.e("MXDIAG", "setDiagFlags ignoré", t)
      }
    }

    /** Ajoute une ligne au journal (miroir des breadcrumbs JS). */
    Function("appendDiagLog") { line: String ->
      try {
        MelodixDiagLog.step("JS", line)
      } catch (t: Throwable) {
        android.util.Log.e("MXDIAG", "appendDiagLog ignoré", t)
      }
    }

    /** Lit le journal complet (copie/partage depuis Réglages). */
    Function("readDiagLog") {
      try {
        return@Function MelodixDiagLog.readAll()
      } catch (t: Throwable) {
        android.util.Log.e("MXDIAG", "readDiagLog en échec", t)
        return@Function ""
      }
    }

    /** Vide le journal. */
    Function("clearDiagLog") {
      try {
        MelodixDiagLog.clear()
      } catch (t: Throwable) {
        android.util.Log.e("MXDIAG", "clearDiagLog ignoré", t)
      }
      return@Function null
    }

    /**
     * Copie le diagnostic COMPLET dans le presse-papiers système Android
     * (ClipboardManager — posté sur le main thread). Retourne true si la
     * copie a été planifiée avec un contenu non vide, false sinon.
     * Jamais de throw : le diagnostic ne doit pas perturber l'UI.
     */
    Function("copyDiagLog") {
      try {
        val context = appContext.reactContext
        val content = MelodixDiagLog.readAll()
        if (context == null || content.isEmpty()) {
          return@Function false
        }
        android.os.Handler(android.os.Looper.getMainLooper()).post {
          try {
            val clipboard = context.getSystemService(
              android.content.Context.CLIPBOARD_SERVICE
            ) as? android.content.ClipboardManager
            clipboard?.setPrimaryClip(
              android.content.ClipData.newPlainText("Melodix diagnostic", content)
            )
          } catch (t: Throwable) {
            android.util.Log.e("MXDIAG", "copie presse-papiers ignorée", t)
          }
        }
        return@Function true
      } catch (t: Throwable) {
        android.util.Log.e("MXDIAG", "copyDiagLog ignoré", t)
        return@Function false
      }
    }

    /**
     * Statut instantané de la couche MediaSession (booléens internes du
     * contrôleur — aucune donnée sensible), pour l'écran Réglages.
     *
     * V37 : le statut du VERROU DE VISIBILITÉ de la notification est joint —
     * sur Android 13+, une notification foreground est MASQUÉE du tiroir tant
     * que POST_NOTIFICATIONS n'est pas accordée (le service tourne, mais la
     * notification n'est visible que dans le gestionnaire de tâches FGS).
     * Un diagnostic appareil en UN SEUL écran : état service + verrou.
     */
    Function("readDiagStatus") {
      try {
        val context = appContext.reactContext?.applicationContext
        val gate =
          if (context != null) notificationGateStatus(context)
          else "notificationGate=contexteAbsent"
        return@Function "${MelodixMediaController.diagStatus()} | $gate"
      } catch (t: Throwable) {
        android.util.Log.e("MXDIAG", "readDiagStatus ignoré", t)
        return@Function "indisponible"
      }
    }

    OnDestroy {
      permissionPollGeneration += 1
      mainHandler.removeCallbacksAndMessages(null)
      // Le contexte React n'existe plus : plus aucun événement ne peut être
      // délivré au JS, le récepteur doit donc être retiré du système.
      applicationContext?.let { unregisterNoisyAudioReceiver(it) }
      MelodixDiagLog.step("MODULE_ONDESTROY")
      MelodixMediaController.commandListener = null
      // Une instance React détruite ne peut plus recevoir les commandes
      // système ni projeter l'état réel. Ne jamais laisser une MediaSession
      // figée afficher une ancienne chanson jusqu'au prochain lancement.
      applicationContext?.let { MelodixMediaController.stopSession(it) }
      applicationContext = null
    }

    /**
     * Projection d'état : métadonnées + position + playing/paused.
     * Démarre le Foreground Service à la première projection active.
     * Blindage 5C.2 : JAMAIS de throw vers le JS — l'audio n'en dépend pas.
     */
    Function("updateSession") { payload: Map<String, Any?> ->
      try {
        // DIAG 4.4.5-diagnostic : la Function Expo est bien atteinte.
        android.util.Log.i("MXDIAG", "MEDIA_SESSION_UPDATE_CALL")
        val context = appContext.reactContext
        if (context == null) {
          MelodixDiagLog.step("NATIVE_UPDATE_NO_REACT_CONTEXT")
          return@Function
        }
        MelodixDiagLog.step(
          "NATIVE_UPDATE_RECEIVED",
          "state=${if (payload["isPlaying"] == true) "PLAYING" else "PAUSED"} keys=${payload.keys.size}"
        )
        MelodixMediaController.updateSession(context, payload)
      } catch (t: Throwable) {
        android.util.Log.e(TAG, "updateSession ignoré — lecture préservée", t)
      }
    }

    /**
     * Permission Android 13+ POST_NOTIFICATIONS (phase 5C, §10 du cahier) :
     * demandée au RUNTIME depuis un geste utilisateur : activation du réglage
     * ou première lecture volontaire. La lecture n'est JAMAIS bloquée :
     * le Foreground Service média fonctionne sans cette permission, Android
     * gère seulement la VISIBILITÉ de la notification.
     *
     * @return true si accordée (ou inutile < Android 13), false si refusée
     *         ou demande en cours, null sans contexte utilisable.
     */
    Function("requestNotificationPermission") {
      try {
        // Avant Android 13 (33) : la permission n'existe pas → accord tacite.
        if (Build.VERSION.SDK_INT < 33) {
          return@Function true
        }

        val context = appContext.reactContext ?: return@Function null
        MelodixMediaNotificationProvider.ensureMediaChannel(context)
        val manager = context.getSystemService(NotificationManager::class.java)
        val channelImportance =
          manager?.getNotificationChannel(MelodixMediaNotificationProvider.CHANNEL_ID)?.importance
        val granted =
          ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) ==
            PackageManager.PERMISSION_GRANTED
        MelodixDiagLog.step(
          "NOTIFICATION_PERMISSION",
          "granted=$granted channelImportance=$channelImportance notificationsEnabled=${manager?.areNotificationsEnabled()}"
        )

        if (granted) {
          return@Function true
        }

        val activity = appContext.currentActivity
        if (activity == null) {
          // null indique au bridge JS qu'aucune demande n'a réellement été
          // lancée : il pourra réessayer sur une projection ultérieure.
          MelodixDiagLog.step("NOTIFICATION_PERMISSION_NO_ACTIVITY")
          return@Function null
        }

        // requestPermissions DOIT s'exécuter sur le thread principal ;
        // les Function Expo peuvent s'exécuter hors main thread. Toute
        // erreur système (activité mourante, état transitoire) est capturée :
        // la lecture n'en dépend JAMAIS.
        activity.runOnUiThread {
          try {
            MelodixDiagLog.step("NOTIFICATION_PERMISSION_REQUESTED")
            ActivityCompat.requestPermissions(
              activity,
              arrayOf(Manifest.permission.POST_NOTIFICATIONS),
              REQUEST_CODE_POST_NOTIFICATIONS
            )
            observeNotificationPermissionResult(context.applicationContext)
          } catch (t: Throwable) {
            android.util.Log.e(TAG, "Demande de permission non aboutie", t)
          }
        }

        false
      } catch (t: Throwable) {
        android.util.Log.e(TAG, "Vérification de permission impossible", t)
        null
      }
    }

    /** Ferme la session et arrête le Foreground Service proprement. */
    Function("stopSession") {
      // Lambda FunctionWithoutArgs () -> Any? (expo-modules-core 1.12.25) :
      // le label nu vaut Unit → return@Function null (convention Expo,
      // cf. CoreModule.kt) ; updateSession n'en a pas besoin (R inféré Unit).
      try {
        val context = appContext.reactContext ?: return@Function null
        MelodixMediaController.stopSession(context)
      } catch (t: Throwable) {
        android.util.Log.e(TAG, "stopSession ignoré", t)
        null
      }
    }
  }
}
