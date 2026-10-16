import * as React from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import Ionicons from '@expo/vector-icons/Ionicons';

import { COLORS } from '@config';
import { usePreferences, useAccent } from '@context';
import {
  getSpotifyWebPhysicalValidation,
  getSpotifyWebPhysicalValidationEvidence,
  isSpotifyWebPlaybackEnabled,
  recordSpotifyWebPhysicalValidation,
  resolveSpotifyWebIntegrationReadiness,
  resolveSpotifyWebPlaybackActivation,
  setSpotifyWebPlaybackEnabled,
  subscribeSpotifyWebPublishedState,
  subscribeSpotifyWebPlaybackActivation,
} from '@services';
import { SettingsSwitch } from '../../components/Settings/SettingsSwitch';

/**
 * Réglage « Lecture Spotify Web » — et l'état HONNÊTE de la porte.
 *
 * Trois états distincts, tous affichés (audit Mission V21) :
 *  1. le réglage utilisateur (ce switch, actif par défaut) ;
 *  2. l'activation technique (flag local en mémoire, levée au démarrage —
 *     section développeur) : elle autorise l'ESSAI, rien de plus ;
 *  3. la validation physique (section développeur) : STATUT, non verrou.
 *     `NOT_TESTED` par défaut — le code ne consigne jamais lui-même un
 *     test physique (correction V21). Elle est levée uniquement par une
 *     consigne utilisateur avec preuve documentée
 *     (docs/SPOTIFY-WEB-PHYSICAL-TEST.md, table de résultats remplie).
 * Une lecture n'est JAMAIS déclarée par un switch ni un statut : seul un
 * état `playing` publié par la page Spotify (bonne piste, bonne session)
 * le permet. Quand le switch utilisateur est éteint, les pistes Spotify ne
 * sont plus lisibles (vraie erreur, pas de relais Audius/YouTube). Rien
 * n'est masqué, rien n'est simulé.
 */
export default function SpotifyWebPlayerSettings() {
  const router = useRouter();
  const accent = useAccent();
  const { spotifyWebPlayback, setSpotifyWebPlayback } = usePreferences();

  const [activation, setActivation] = React.useState(() =>
    resolveSpotifyWebPlaybackActivation()
  );
  const [readiness, setReadiness] = React.useState(() =>
    resolveSpotifyWebIntegrationReadiness()
  );
  const [evidence, setEvidence] = React.useState(
    () => getSpotifyWebPhysicalValidationEvidence() ?? ''
  );
  const [recordError, setRecordError] = React.useState<string | null>(null);

  // Photos vivantes : l'activation (flag/porte) et l'état publié (hôte/pont)
  // évoluent sans timer — chaque événement de bus re-rend la page.
  React.useEffect(
    () =>
      subscribeSpotifyWebPlaybackActivation(() => {
        setActivation(resolveSpotifyWebPlaybackActivation());
        setReadiness(resolveSpotifyWebIntegrationReadiness());
      }),
    []
  );
  React.useEffect(
    () =>
      subscribeSpotifyWebPublishedState(() => {
        setReadiness(resolveSpotifyWebIntegrationReadiness());
      }),
    []
  );

  const physicalValidation = getSpotifyWebPhysicalValidation();
  const flagEnabled = isSpotifyWebPlaybackEnabled();
  const gateOpen = activation.active;

  const recordPassed = () => {
    try {
      recordSpotifyWebPhysicalValidation(true, evidence);
      setRecordError(null);
    } catch (error) {
      setRecordError(
        error instanceof Error ? error.message : 'preuve documentée requise'
      );
    }
  };

  const recordNotPassed = () => {
    recordSpotifyWebPhysicalValidation(false, null);
    setEvidence('');
    setRecordError(null);
  };

  return (
    <View style={styles.screen} testID="spotify-web-settings-screen">
      <View style={styles.header}>
        <Pressable
          accessibilityLabel="Retour"
          onPress={() => router.back()}
          style={styles.iconButton}
          testID="spotify-web-settings-back"
        >
          <Ionicons color={COLORS.WHITE} name="arrow-back" size={26} />
        </Pressable>
        <Text style={styles.title}>Lecture Spotify Web</Text>
        <View style={styles.iconButton} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {/* ── État de la lecture ─────────────────────────────────────── */}
        <Text style={styles.sectionTitle}>Lecture</Text>
        <View style={styles.card}>
          <SettingsSwitch
            label="Lire via Spotify Web"
            subtitle={
              gateOpen
                ? 'Seule source audio pour les pistes Spotify. Si la lecture n’est pas réellement confirmée, une vraie erreur Spotify Web est affichée (aucun relais Audius/YouTube).'
                : 'Indisponible : l’activation technique (flag local) doit être levée (section développement ci-dessous).'
            }
            value={gateOpen && spotifyWebPlayback}
            onValueChange={(value) => {
              if (!gateOpen) return;
              setSpotifyWebPlayback(value);
            }}
            testID="spotify-web-playback"
          />
        </View>

        <View style={styles.card} testID="spotify-web-readiness">
          <Text style={styles.readinessLabel}>
            État de disponibilité :{' '}
            <Text style={{ color: readiness.ready ? accent : COLORS.WHITE }}>
              {readiness.ready ? 'prête' : 'non prête'}
            </Text>
          </Text>
          {readiness.blockers.map((blocker) => (
            <Text key={blocker} style={styles.readinessBlocker}>
              • {blocker}
            </Text>
          ))}
          <Text style={styles.readinessHint}>
            « prête » = activation technique + hôte monté + pont prêt. La
            validation physique est un statut affiché ci-dessous (non bloquant)
            — et un morceau n’est jamais déclaré lu avant confirmation réelle
            (état publié par la page).
          </Text>
        </View>

        {/* ── Développement / validation ─────────────────────────────── */}
        <Text style={styles.sectionTitle}>Développement</Text>
        <View style={styles.card}>
          <SettingsSwitch
            label="Flag local (mémoire, non persisté)"
            subtitle="Premier verrou de la porte d’activation. Ne prouve aucune lecture."
            value={flagEnabled}
            onValueChange={setSpotifyWebPlaybackEnabled}
            isLast={false}
            testID="spotify-web-flag"
          />
          <SettingsSwitch
            label="Validation physique (statut, non bloquant)"
            subtitle={
              physicalValidation === 'PASSED_ON_DEVICE'
                ? `Consignée : ${getSpotifyWebPhysicalValidationEvidence() ?? ''}`
                : 'NON VÉRIFIÉE SUR APPAREIL : le code ne consigne jamais un test physique (audit V21). Le moteur reste actif en mode technique ; pour consigner un test réel, remplir la référence ci-dessous (docs/SPOTIFY-WEB-PHYSICAL-TEST.md) puis « Consigner PASSED ».'
            }
            value={physicalValidation === 'PASSED_ON_DEVICE'}
            onValueChange={(value) => {
              if (value) {
                // Une preuve documentée est exigée : le statut ne peut pas
                // être levé par un simple switch — le champ porte la
                // référence du compte rendu.
                recordPassed();
              } else {
                recordNotPassed();
              }
            }}
            isLast={false}
            testID="spotify-web-validation"
          />
          <View style={styles.evidenceBox}>
            <Text style={styles.evidenceLabel}>Référence de preuve</Text>
            <TextInput
              value={evidence}
              onChangeText={setEvidence}
              placeholder="ex. phone-run 2026-10-06 : lecture réelle + source media-session consignées dans docs/SPOTIFY-WEB-PHYSICAL-TEST.md"
              placeholderTextColor={COLORS.GREY}
              style={styles.evidenceInput}
              testID="spotify-web-evidence-input"
            />
            <Pressable
              onPress={recordPassed}
              style={[styles.recordButton, { backgroundColor: accent }]}
              testID="spotify-web-record-passed"
            >
              <Text style={styles.recordButtonText}>
                Consigner PASSED (preuve ci-dessus)
              </Text>
            </Pressable>
            <Pressable
              onPress={recordNotPassed}
              style={styles.recordButtonGhost}
              testID="spotify-web-record-not-passed"
            >
              <Text style={styles.recordButtonTextGhost}>
                Repasser à NOT_TESTED
              </Text>
            </Pressable>
            {recordError ? (
              <Text style={styles.recordError}>{recordError}</Text>
            ) : null}
          </View>
          <Text style={styles.cardNote}>
            Séparation des trois états (audit V21) : l’activation technique
            (flag) autorise l’essai ; la validation physique est un statut
            affiché honnêtement ; seule la confirmation réelle — un état «
            playing » publié par la page pour la bonne piste et la bonne session
            — déclare une lecture.
          </Text>
        </View>

        {/* ── Diagnostic ─────────────────────────────────────────────── */}
        <Pressable
          onPress={() => router.push('/settings/spotify-web-diagnostic')}
          style={styles.diagButton}
          testID="spotify-web-open-diagnostic"
        >
          <Ionicons color={COLORS.WHITE} name="pulse" size={18} />
          <Text style={styles.diagButtonText}>
            Ouvrir le diagnostic WebView (isolé)
          </Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.NAV,
    borderRadius: 12,
    marginBottom: 8,
    paddingHorizontal: 14,
    paddingVertical: 6,
  },
  cardNote: {
    color: COLORS.GREY,
    fontSize: 11,
    marginTop: 6,
    paddingVertical: 8,
  },
  content: { padding: 16, paddingBottom: 40 },
  diagButton: {
    alignItems: 'center',
    backgroundColor: COLORS.SECONDARY,
    borderRadius: 12,
    flexDirection: 'row',
    gap: 8,
    justifyContent: 'center',
    marginTop: 8,
    paddingVertical: 14,
  },
  diagButtonText: { color: COLORS.WHITE, fontSize: 14, fontWeight: '600' },
  evidenceBox: {
    borderTopWidth: 1,
    borderTopColor: COLORS.SECONDARY,
    marginTop: 4,
    paddingTop: 10,
  },
  evidenceInput: {
    backgroundColor: COLORS.PRIMARY,
    borderColor: COLORS.GREY,
    borderRadius: 8,
    borderWidth: 1,
    color: COLORS.WHITE,
    fontSize: 12,
    minHeight: 64,
    padding: 10,
  },
  evidenceLabel: { color: COLORS.LIGHT_GREY, fontSize: 12, marginBottom: 6 },
  header: {
    alignItems: 'center',
    backgroundColor: COLORS.NAV,
    flexDirection: 'row',
    paddingHorizontal: 8,
    paddingTop: 12,
  },
  iconButton: {
    alignItems: 'center',
    height: 44,
    justifyContent: 'center',
    width: 44,
  },
  readinessBlocker: { color: COLORS.WHITE, fontSize: 12, marginTop: 4 },
  readinessHint: { color: COLORS.GREY, fontSize: 11, marginTop: 8 },
  readinessLabel: { color: COLORS.LIGHT_GREY, fontSize: 13 },
  recordButton: {
    borderRadius: 8,
    marginTop: 10,
    paddingVertical: 10,
  },
  recordButtonText: { color: COLORS.PRIMARY, fontSize: 13, fontWeight: '700' },
  recordButtonGhost: { marginTop: 8, paddingVertical: 6 },
  recordButtonTextGhost: {
    alignSelf: 'center',
    color: COLORS.GREY,
    fontSize: 12,
  },
  recordError: { color: '#ff6b6b', fontSize: 11, marginTop: 8 },
  screen: { backgroundColor: COLORS.PRIMARY, flex: 1 },
  sectionTitle: {
    color: COLORS.GREY,
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 6,
    marginTop: 14,
    textTransform: 'uppercase',
  },
  title: { color: COLORS.WHITE, fontSize: 17, fontWeight: '600' },
});
