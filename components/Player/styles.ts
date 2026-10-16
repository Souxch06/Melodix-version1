import { StyleSheet } from 'react-native';

import { COLORS, ELEVATION, PALETTE, RADIUS } from '@config';

/**
 * Surfaces du lecteur — alignées sur le design system (config/theme.ts).
 *
 * Identité retenue : bleu nuit profond + violet subtil. Le mini-lecteur est
 * une surface SURÉLEVÉE (night600 + liseré violet) qui se détache du fond
 * night900 sans crier — pas de gris neutre, pas de vert agressif.
 */
export const styles = StyleSheet.create({
  wrapper: {
    width: '96%',
    alignSelf: 'center',
    backgroundColor: PALETTE.night600,
    borderColor: PALETTE.hairline,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderLeftWidth: StyleSheet.hairlineWidth,
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRadius: RADIUS.lg,
    marginBottom: RADIUS.sm,
    overflow: 'hidden',
    ...ELEVATION.floating,
  },
  noticeBar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: PALETTE.violet700,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  noticeIcon: {
    marginRight: 6,
  },
  noticeText: {
    flex: 1,
    color: COLORS.WHITE,
    fontSize: 12,
  },
  openArea: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  progressTrack: {
    height: 2,
    width: '100%',
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
  },
  progressFill: {
    height: 2,
    backgroundColor: COLORS.TINT,
  },
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  artwork: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.sm,
    backgroundColor: PALETTE.night700,
  },
  info: {
    flex: 1,
    marginLeft: 10,
    marginRight: 6,
  },
  title: {
    color: COLORS.WHITE,
    fontSize: 14,
    fontWeight: '600',
  },
  subtitle: {
    color: COLORS.LIGHT_GREY,
    fontSize: 12,
    marginTop: 2,
  },
  control: {
    width: 40,
    height: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
