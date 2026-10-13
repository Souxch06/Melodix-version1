import * as React from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  Text,
  View,
} from 'react-native';
import { Image } from 'expo-image';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import Ionicons from '@expo/vector-icons/Ionicons';

import { useAccent, usePlayer } from '@context';
import { COLORS } from '@config';
import { translations } from '@data';
import { getFallbackImage } from '@utils';

import type { PlayerTrack } from '@services';

import { DragSlider } from './DragSlider';
import { JamendoAttribution } from './JamendoAttribution';
import { QueueActionMenu } from './QueueActionMenu';
import { QueueRow } from './QueueRow';
import { styles } from './fullStyles';

// Durée d'affichage de la notice d'erreur — IDENTIQUE au MiniPlayer
// (cohérence mini/plein écran exigée par la phase 1, section 3).
const NOTICE_DURATION_MS = 4500;

const formatMillis = (value: number): string => {
  const totalSeconds = Math.max(0, Math.round(value / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;

  return `${minutes}:${String(seconds).padStart(2, '0')}`;
};

/**
 * Full-screen player: artwork, seek, previous/next, shuffle, repeat, volume,
 * queue. Streams come from the default audio provider (Audius); the badge
 * under the controls states which provider is playing the current track.
 */
export const FullPlayer = () => {
  const router = useRouter();
  const { top, bottom } = useSafeAreaInsets();
  const player = usePlayer();
  const accent = useAccent();
  const {
    current,
    queue,
    index: currentIndex,
    status,
    buffering,
    positionMillis,
    durationMillis,
    shuffle,
    repeat,
    volume,
    providerName,
    notice,
    togglePlayPause,
    next,
    previous,
    seekTo,
    setVolume,
    toggleShuffle,
    cycleRepeat,
    playAtIndex,
    stop,
    clearNotice,
    removeFromQueue,
    moveInQueue,
    clearQueue,
  } = player;

  // Menu d'actions du morceau COURANT (phase 4, §7) : le MÊME composant
  // réutilisable QueueActionMenu — aucun menu parallèle créé.
  const [currentMenuVisible, setCurrentMenuVisible] = React.useState(false);

  const handlePlayQueueIndex = React.useCallback(
    (rowIndex: number) => {
      void playAtIndex(rowIndex);
    },
    [playAtIndex]
  );
  const handleMoveUp = React.useCallback(
    (rowIndex: number) => moveInQueue(rowIndex, rowIndex - 1),
    [moveInQueue]
  );
  const handleMoveDown = React.useCallback(
    (rowIndex: number) => moveInQueue(rowIndex, rowIndex + 1),
    [moveInQueue]
  );

  const renderQueueRow = React.useCallback(
    ({ item, index: rowIndex }: { item: PlayerTrack; index: number }) => (
      <QueueRow
        accent={accent}
        index={rowIndex}
        isCurrent={rowIndex === currentIndex}
        isFirst={rowIndex === 0}
        isLast={rowIndex === queue.length - 1}
        isPlaying={status === 'playing'}
        onMoveDown={handleMoveDown}
        onMoveUp={handleMoveUp}
        onPlay={handlePlayQueueIndex}
        onRemove={removeFromQueue}
        track={item}
      />
    ),
    [
      accent,
      currentIndex,
      queue.length,
      status,
      handleMoveDown,
      handleMoveUp,
      handlePlayQueueIndex,
      removeFromQueue,
    ]
  );

  // Mémoire MUTE : dernier volume NON NUL observé. Ce n'est PAS une 2e
  // source de vérité : le volume réel reste `volume` (état moteur) ; ce
  // ref ne sert qu'à retrouver le niveau d'avant mute (persistance Phase 2
  // compatible : un volume restauré > 0 s'y installe automatiquement).
  const lastAudibleVolumeRef = React.useRef(0.5);
  // Preview du seek pendant le drag : affichage mm:ss immédiat sans toucher
  // le moteur (le seek final n'arrive qu'au relâchement).
  const [seekPreviewMillis, setSeekPreviewMillis] = React.useState<
    number | null
  >(null);

  const volumeRef = React.useRef(volume);

  React.useEffect(() => {
    volumeRef.current = volume;
    if (volume > 0) {
      lastAudibleVolumeRef.current = volume;
    }
  }, [volume]);

  // Notice : affichée puis expirée automatiquement — jamais figée sur le
  // Full Player (le moteur la vide déjà au démarrage du morceau suivant).
  React.useEffect(() => {
    if (!notice) {
      return;
    }

    const timeout = setTimeout(clearNotice, NOTICE_DURATION_MS);

    return () => clearTimeout(timeout);
  }, [notice, clearNotice]);

  // Opened without an active session: nothing to show, go back. Le hook doit
  // rester inconditionnel (règle des hooks) : le garde-fou est DANS l'effet.
  React.useEffect(() => {
    if (!current) {
      router.back();
    }
  }, [current, router]);

  if (!current) {
    return null;
  }

  const progress =
    durationMillis > 0 ? Math.min(positionMillis / durationMillis, 1) : 0;
  // Position affichée : preview pendant le drag, sinon position réelle.
  const previewProgress =
    seekPreviewMillis !== null && durationMillis > 0
      ? Math.min(seekPreviewMillis / durationMillis, 1)
      : progress;
  const isMuted = volume <= 0;
  const seekShownMillis = seekPreviewMillis ?? positionMillis;
  const isPlaying = status === 'playing';
  // Un seul prédicat « en attente » couvre les trois phases où aucun son
  // ne sort encore : préparation (loading), résolution de la source
  // (resolving), chargement du flux (buffering). La barre de progression
  // reste neutralisée pendant ces phases — une position fantaisiste pendant
  // une résolution serait pire qu'une barre figée.
  const isBuffering =
    status === 'loading' ||
    status === 'resolving' ||
    status === 'buffering' ||
    buffering;
  // Fin de file atteinte : le bouton principal propose de RELIRE, et la
  // barre affiche l'état réel au lieu de rester sur « lecture ».
  const hasEnded = status === 'ended';
  // Durée réelle pas encore connue (avant le 1er statut expo-av ou sans
  // métadonnée Spotify) : « —:-- » honnête + seek désactivé — jamais « 0:00 »
  // présenté comme une durée réelle (phase 1, section 4).
  const durationKnown = durationMillis > 0;

  const handleSeekEnd = (ratio: number) => {
    if (durationKnown) {
      void seekTo(Math.round(ratio * durationMillis));
    }
  };

  /** Mute/Unmute — mémorise le dernier volume non nul (jamais perdu). */
  const handleMuteToggle = () => {
    if (isMuted) {
      void setVolume(
        lastAudibleVolumeRef.current > 0 ? lastAudibleVolumeRef.current : 0.5
      );
    } else {
      lastAudibleVolumeRef.current = volumeRef.current;
      void setVolume(0);
    }
  };

  const repeatIcon =
    repeat === 'one'
      ? 'repeat-outline'
      : repeat === 'all'
        ? 'repeat'
        : 'repeat';
  const repeatActive = repeat !== 'off';

  return (
    <View
      style={[
        styles.container,
        { paddingTop: top + 8, paddingBottom: bottom + 16 },
      ]}
    >
      <View style={styles.header}>
        <Pressable
          onPress={() => router.back()}
          style={styles.headerButton}
          accessibilityRole="button"
          accessibilityLabel={translations.playerClose}
        >
          <Ionicons name="chevron-down" size={26} color={COLORS.WHITE} />
        </Pressable>
        <Text numberOfLines={1} style={styles.headerTitle}>
          {current.album ?? current.artists.join(', ')}
        </Text>
        <View style={styles.headerButton} />
      </View>

      <View style={styles.artworkWrap}>
        <Image
          style={styles.artwork}
          source={
            current.imageURL
              ? { uri: current.imageURL }
              : getFallbackImage('track')
          }
        />
      </View>

      <View style={styles.metaWrap}>
        <View style={styles.titleRow}>
          <Text numberOfLines={1} style={[styles.title, styles.titleFlex]}>
            {current.title}
          </Text>
          {/* ⋯ du morceau courant : « Ajouter à la file » / « Lire ensuite »
              — réutilise le menu partagé (phase 4, §7), jamais de doublon. */}
          <Pressable
            accessibilityLabel={translations.playerQueueTrackActions(
              current.title
            )}
            accessibilityRole="button"
            hitSlop={10}
            onPress={() => setCurrentMenuVisible(true)}
            style={styles.moreActions}
            testID="current-actions"
          >
            <Ionicons
              name="ellipsis-horizontal"
              size={18}
              color={COLORS.GREY}
            />
          </Pressable>
        </View>
        <Text numberOfLines={1} style={styles.subtitle}>
          {current.artists.join(', ')}
        </Text>
        {providerName ? (
          <Text style={styles.providerBadge}>
            {translations.playerStreamedWith(providerName)}
          </Text>
        ) : null}
        {/* V50 — Attribution Jamendo (clause 4.1 des conditions d'utilisation
            de l'API) : crédit du créateur, mention de Jamendo comme
            fournisseur et lien vers la page d'origine. Rendu UNIQUEMENT pour
            une piste Jamendo dont l'attribution est connue : `null` pour
            Audius, YouTube, iTunes et Spotify — jamais de faux crédit. */}
        <JamendoAttribution trackId={current.id} />
        {notice ? (
          <Text numberOfLines={2} style={styles.noticeText}>
            {notice.kind === 'not-available'
              ? translations.playerTrackUnavailable(notice.title)
              : translations.playerTrackPlayFailed(notice.title, notice.code)}
          </Text>
        ) : null}
      </View>

      <View style={styles.seekWrap}>
        {/* Glissable (phase 3) : preview pendant le drag, UN seek final.
            `key` = morceau : le changement de piste annule toute preview
            emportée (jamais d'ancienne position sur le nouveau morceau). */}
        <DragSlider
          key={current.id}
          accessibilityLabel={translations.playerSeek}
          accessibilityValueText={`${formatMillis(seekShownMillis)} / ${
            durationKnown ? formatMillis(durationMillis) : '—:--'
          }`}
          disabled={!durationKnown}
          onSlideChange={(ratio) =>
            durationKnown
              ? setSeekPreviewMillis(Math.round(ratio * durationMillis))
              : undefined
          }
          onSlideEnd={(ratio) => {
            setSeekPreviewMillis(null);
            handleSeekEnd(ratio);
          }}
          testID="full-seek-slider"
          value={previewProgress}
        />
        <View style={styles.timesRow}>
          <Text style={styles.timeText}>{formatMillis(seekShownMillis)}</Text>
          <Text style={styles.timeText} testID="full-player-duration">
            {durationKnown ? formatMillis(durationMillis) : '—:--'}
          </Text>
        </View>
      </View>

      <View style={styles.controlsRow}>
        <Pressable
          onPress={toggleShuffle}
          style={styles.smallControl}
          accessibilityRole="button"
          accessibilityState={{ selected: shuffle }}
          hitSlop={8}
          accessibilityLabel={translations.playerShuffle}
        >
          <Ionicons
            name="shuffle"
            size={22}
            color={shuffle ? accent : COLORS.GREY}
          />
        </Pressable>
        <Pressable
          onPress={previous}
          style={styles.control}
          accessibilityRole="button"
          accessibilityLabel={translations.playerPrevious}
        >
          <Ionicons name="play-skip-back" size={30} color={COLORS.WHITE} />
        </Pressable>
        {isBuffering ? (
          <ActivityIndicator
            color={COLORS.WHITE}
            style={styles.playButton}
            accessibilityLabel={translations.playerLoading}
          />
        ) : hasEnded ? (
          // Fin de file : rejouer le morceau affiché depuis le début.
          <Pressable
            onPress={() => handlePlayQueueIndex(currentIndex)}
            style={styles.playButton}
            accessibilityRole="button"
            accessibilityLabel={translations.playerPlay}
            testID="full-player-replay"
          >
            <Ionicons name="reload" size={30} color={COLORS.BLACK} />
          </Pressable>
        ) : (
          <Pressable
            onPress={togglePlayPause}
            style={styles.playButton}
            accessibilityRole="button"
            accessibilityLabel={
              isPlaying ? translations.playerPause : translations.playerPlay
            }
          >
            <Ionicons
              name={isPlaying ? 'pause' : 'play'}
              size={32}
              color={COLORS.BLACK}
            />
          </Pressable>
        )}
        <Pressable
          onPress={next}
          style={styles.control}
          accessibilityRole="button"
          accessibilityLabel={translations.playerNext}
        >
          <Ionicons name="play-skip-forward" size={30} color={COLORS.WHITE} />
        </Pressable>
        <Pressable
          accessibilityState={{ selected: repeat !== 'off' }}
          hitSlop={8}
          onPress={cycleRepeat}
          style={styles.smallControl}
          accessibilityRole="button"
          accessibilityLabel={
            repeat === 'one'
              ? translations.playerRepeatOne
              : translations.playerRepeat
          }
        >
          <Ionicons
            name={repeatIcon}
            size={22}
            color={repeatActive ? accent : COLORS.GREY}
          />
          {repeat === 'one' ? <View style={styles.repeatDot} /> : null}
        </Pressable>
      </View>

      <View style={styles.volumeRow}>
        <Ionicons name="volume-low" size={18} color={COLORS.GREY} />
        <View style={styles.volumeTrack}>
          <DragSlider
            accessibilityLabel={translations.playerVolume}
            accessibilityValueText={`${Math.round(volume * 100)} %`}
            fillColor={COLORS.LIGHT_GREY}
            onSlideEnd={(ratio) => void setVolume(ratio)}
            testID="full-volume-slider"
            value={volume}
          />
        </View>
        <Pressable
          accessibilityLabel={
            isMuted ? translations.playerUnmute : translations.playerMute
          }
          accessibilityRole="button"
          accessibilityState={{ selected: isMuted }}
          onPress={handleMuteToggle}
          style={styles.muteButton}
          testID="full-mute-button"
        >
          <Ionicons
            name={isMuted ? 'volume-mute' : 'volume-high'}
            size={18}
            color={isMuted ? COLORS.TINT : COLORS.GREY}
          />
        </Pressable>
      </View>

      <View style={styles.queueHeaderRow}>
        <Text style={styles.queueTitle}>{translations.playerQueueTitle}</Text>
        <View style={styles.queueHeaderActions}>
          {/* Position réelle dans la file ORIGINALE (§5) — jamais l'ordre
              shuffle affiché : `order` reste interne au moteur. */}
          <Text style={styles.queueCount} testID="queue-count">
            {currentIndex + 1} / {queue.length}
          </Text>
          <Pressable
            accessibilityLabel={translations.playerQueueClear}
            accessibilityRole="button"
            hitSlop={8}
            onPress={() => void clearQueue()}
            testID="queue-clear"
          >
            <Text style={styles.queueClear}>
              {translations.playerQueueClear}
            </Text>
          </Pressable>
        </View>
      </View>
      {queue.length ? (
        <FlatList
          data={queue}
          keyExtractor={(item, idx) => `${item.id}:${idx}`}
          style={styles.queueList}
          // Queue longue : virtualisée (phase 2/4, performance §8) — lignes
          // mémoïsées (QueueRow) + rendu borné par batch.
          initialNumToRender={12}
          maxToRenderPerBatch={10}
          renderItem={renderQueueRow}
          windowSize={7}
        />
      ) : (
        <Text style={styles.queueEmpty} testID="queue-empty">
          {translations.playerQueueEmpty}
        </Text>
      )}

      <QueueActionMenu
        onClose={() => setCurrentMenuVisible(false)}
        track={currentMenuVisible ? current : null}
        visible={currentMenuVisible}
      />

      <Pressable
        onPress={() => {
          void stop();
          router.back();
        }}
        style={styles.closeSession}
        accessibilityRole="button"
        accessibilityLabel={translations.playerStop}
      >
        <Ionicons name="close" size={20} color={COLORS.GREY} />
      </Pressable>
    </View>
  );
};
