import { PALETTE, RADIUS, SPACING, TOUCH_TARGET, TYPOGRAPHY } from '@config';
import { StyleSheet } from 'react-native';

export const styles = StyleSheet.create({
  summary: {
    paddingTop: 20,
    paddingHorizontal: 16,
    paddingBottom: 14,
  },
  title: {
    ...TYPOGRAPHY.title,
    marginRight: 'auto',
    minHeight: TYPOGRAPHY.title.lineHeight,
  },
  subtitle: {
    ...TYPOGRAPHY.body,
    fontWeight: '600',
    color: PALETTE.textPrimary,
    marginTop: SPACING.sm,
    marginRight: 'auto',
    minHeight: TYPOGRAPHY.body.lineHeight,
  },
  info: {
    ...TYPOGRAPHY.caption,
    marginTop: SPACING.xs,
    textTransform: 'capitalize',
    minHeight: TYPOGRAPHY.caption.lineHeight,
  },
  pressablesView: {
    maxWidth: 120,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 13,
  },
  saveContainer: {
    justifyContent: 'center',
    alignItems: 'center',
    borderRadius: RADIUS.pill,
    width: TOUCH_TARGET.minimum,
    height: TOUCH_TARGET.minimum,
    borderWidth: 1,
    borderColor: PALETTE.hairlineStrong,
    backgroundColor: 'transparent',
  },
  saveContainerActive: {
    backgroundColor: PALETTE.accent,
    borderColor: PALETTE.accent,
  },
  saveIcon: {
    fontSize: 14,
    fontWeight: '900',
    color: PALETTE.textSecondary,
  },
  saveIconActive: {
    fontSize: 16,
    fontWeight: '900',
    color: PALETTE.accent,
  },
  isDownloadedContainer: {
    marginHorizontal: 'auto',
    alignItems: 'center',
    justifyContent: 'center',
    width: TOUCH_TARGET.minimum - 4,
    height: TOUCH_TARGET.minimum - 4,
    borderRadius: RADIUS.pill,
    borderWidth: 1.5,
    backgroundColor: 'transparent',
    borderColor: PALETTE.hairlineStrong,
  },
  isDownloadedContainerActive: {
    fontSize: 12,
    top: 0.5,
    left: 0.5,
    color: PALETTE.textSecondary,
  },
  isDownloadedIcon: {
    backgroundColor: PALETTE.accent,
    borderColor: PALETTE.accent,
  },
  isDownloadedIconActive: {
    color: PALETTE.night900,
  },
  moreButton: {
    alignItems: 'center',
    justifyContent: 'center',
    width: TOUCH_TARGET.minimum,
    height: TOUCH_TARGET.minimum,
    borderRadius: RADIUS.pill,
  },
  moreIcon: {
    fontSize: 20,
    color: PALETTE.textSecondary,
  },
  descriptionText: {
    ...TYPOGRAPHY.body,
    color: PALETTE.textSecondary,
    lineHeight: 19,
    marginTop: SPACING.xxs,
  },
  availabilityInfo: {
    ...TYPOGRAPHY.caption,
    marginTop: SPACING.xxs,
  },
});
