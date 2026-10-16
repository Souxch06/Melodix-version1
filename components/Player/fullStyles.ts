import { StyleSheet } from 'react-native';

import { COLORS, PALETTE, RADIUS, TYPOGRAPHY } from '@config';

export const styles = StyleSheet.create({
  container: {
    flex: 1,
    // Fond bleu nuit profond : identité Melodix (config/theme.ts).
    backgroundColor: PALETTE.night900,
    paddingHorizontal: 20,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  headerButton: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    ...TYPOGRAPHY.label,
    flex: 1,
    color: COLORS.LIGHT_GREY,
    textAlign: 'center',
  },
  artworkWrap: {
    alignItems: 'center',
    marginVertical: 12,
  },
  artwork: {
    width: 280,
    height: 280,
    borderRadius: RADIUS.md,
    backgroundColor: PALETTE.night600,
  },
  metaWrap: {
    marginBottom: 14,
  },
  title: {
    ...TYPOGRAPHY.title,
    color: COLORS.WHITE,
  },
  subtitle: {
    color: COLORS.LIGHT_GREY,
    fontSize: 14,
    marginTop: 4,
  },
  providerBadge: {
    color: PALETTE.violet300,
    fontSize: 11.5,
    fontWeight: '600',
    marginTop: 6,
  },
  noticeText: {
    color: COLORS.RED,
    fontSize: 12,
    lineHeight: 17,
    marginTop: 6,
  },
  seekWrap: {
    marginBottom: 10,
  },
  seekDisabled: {
    opacity: 0.45,
  },
  seekTrack: {
    height: 22,
    flexDirection: 'row',
    alignItems: 'center',
  },
  seekFill: {
    height: 3,
    backgroundColor: COLORS.WHITE,
    borderTopLeftRadius: 2,
    borderBottomLeftRadius: 2,
  },
  seekRest: {
    height: 3,
    backgroundColor: PALETTE.night500,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
  },
  seekThumb: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: COLORS.WHITE,
    marginLeft: -6,
  },
  timesRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  timeText: {
    color: COLORS.GREY,
    fontSize: 11,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 12,
  },
  smallControl: {
    width: 44,
    alignItems: 'center',
  },
  control: {
    width: 56,
    alignItems: 'center',
  },
  playButton: {
    width: 62,
    height: 62,
    borderRadius: RADIUS.pill,
    backgroundColor: COLORS.WHITE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  repeatDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: COLORS.TINT,
    marginTop: 2,
  },
  volumeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 14,
  },
  muteButton: {
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
    minHeight: 34,
    minWidth: 34,
  },
  volumeTrack: {
    flex: 1,
    height: 18,
    marginHorizontal: 10,
    flexDirection: 'row',
    alignItems: 'center',
  },
  volumeFill: {
    height: 3,
    backgroundColor: COLORS.LIGHT_GREY,
    borderTopLeftRadius: 2,
    borderBottomLeftRadius: 2,
  },
  volumeRest: {
    height: 3,
    backgroundColor: COLORS.BORDER_GREY,
    borderTopRightRadius: 2,
    borderBottomRightRadius: 2,
  },
  titleRow: {
    alignItems: 'center',
    flexDirection: 'row',
  },
  titleFlex: {
    flex: 1,
  },
  moreActions: {
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 8,
    minHeight: 34,
    minWidth: 34,
  },
  queueHeaderRow: {
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  queueHeaderActions: {
    alignItems: 'center',
    flexDirection: 'row',
    gap: 12,
  },
  queueCount: {
    color: COLORS.GREY,
    fontSize: 11,
    fontWeight: '600',
  },
  queueClear: {
    color: COLORS.TINT,
    fontSize: 12,
    fontWeight: '700',
  },
  queueEmpty: {
    color: COLORS.GREY,
    fontSize: 12,
    paddingVertical: 12,
    textAlign: 'center',
  },
  queueTitle: {
    ...TYPOGRAPHY.heading,
    color: COLORS.WHITE,
    marginBottom: 8,
  },
  queueList: {
    flex: 1,
  },
  closeSession: {
    position: 'absolute',
    right: 14,
    top: 50,
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
