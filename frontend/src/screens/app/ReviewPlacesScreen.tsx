import React, {useEffect, useState} from 'react';
import {
  ActivityIndicator,
  Alert,
  Modal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {SafeAreaView} from 'react-native-safe-area-context';
import {NativeStackScreenProps} from '@react-navigation/native-stack';
import {AppStackParamList} from '../../types/navigation';
import {placeService} from '../../services/placeService';
import {spaceDetailService} from '../../services/spaceDetailService';
import {homeService, ApiSpace} from '../../services/homeService';
import {colors, fonts, radius, spacing} from '../../theme';
import {Pin} from '../../components/Pin';
import {displayAddress} from '../../utils/address';

type Props = NativeStackScreenProps<AppStackParamList, 'ReviewPlaces'>;

/** Where a place goes: saved places, or a space id. */
type Dest = 'saved' | number;

type Row = {
  included: boolean;
  /** Index into the place's Google candidates — the user can switch branch. */
  cand: number;
  dests: Dest[];
};

type Sheet = {kind: 'dest'; idxs: number[]} | {kind: 'match'; idx: number} | null;

type SavedRow = {name: string; where: string};

/**
 * A TikTok that features several venues (a roundup) lands here instead of the
 * single-place form. Every place carries its own destinations; Select sets
 * one destination on several places at once without touching their others.
 */
export default function ReviewPlacesScreen({route, navigation}: Props) {
  const {spaceId, sourceUrl} = route.params;
  // A venue Google could not match has no pin, so it cannot be saved from
  // here — it is named below the list instead.
  const [places] = useState(() => route.params.places.filter(p => p.candidates.length > 0));
  const unmatched = route.params.places.filter(p => p.candidates.length === 0).map(p => p.name);

  const [rows, setRows] = useState<Row[]>(() =>
    places.map(() => ({
      included: true,
      cand: 0,
      // Opened from a space? That space is the destination, as in CreatePlace.
      dests: spaceId !== undefined ? [spaceId] : ['saved'],
    })),
  );
  const [spaces, setSpaces] = useState<ApiSpace[]>([]);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState<number[]>([]);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState<SavedRow[] | null>(null);

  useEffect(() => {
    // Saved Places still works without the space list.
    homeService.fetchSpaces().then(setSpaces).catch(() => {});
  }, []);

  const destOptions: {key: Dest; icon: string; label: string}[] = [
    {key: 'saved', icon: '📍', label: 'Saved Places'},
    ...spaces.map(sp => ({key: sp.id as Dest, icon: sp.icon, label: sp.name})),
  ];
  const destLabel = (d: Dest) =>
    d === 'saved' ? 'Saved Places' : spaces.find(sp => sp.id === d)?.name ?? 'Space';
  const candOf = (i: number) => places[i].candidates[rows[i].cand];

  // Bulk: all selected have it → remove from all; otherwise add to the rest.
  const toggleDest = (idxs: number[], d: Dest) => {
    const all = idxs.every(i => rows[i].dests.includes(d));
    setRows(prev => prev.map((r, i) => {
      if (!idxs.includes(i)) return r;
      if (all) return {...r, dests: r.dests.filter(x => x !== d)};
      return r.dests.includes(d) ? r : {...r, dests: [...r.dests, d]};
    }));
  };

  const toggleIncluded = (i: number) =>
    setRows(prev => prev.map((r, j) => (j === i ? {...r, included: !r.included} : r)));
  const toggleSelected = (i: number) =>
    setSelected(prev => (prev.includes(i) ? prev.filter(x => x !== i) : [...prev, i]));

  const included = rows.map((r, i) => ({r, i})).filter(x => x.r.included);
  const missing = included.filter(x => x.r.dests.length === 0).length;

  // Sequential on purpose: two creates of the same Google place racing each
  // other could both miss the backend's dedupe.
  const handleSave = async () => {
    setSaving(true);
    const done: SavedRow[] = [];
    const failed: string[] = [];
    for (const {r, i} of included) {
      const c = candOf(i);
      try {
        const place = await placeService.create(c.name, c.lat, c.lng, c.address, r.dests.includes('saved'), c.google_place_id, sourceUrl);
        const reached: Dest[] = r.dests.includes('saved') ? ['saved'] : [];
        for (const d of r.dests) {
          if (d === 'saved') continue;
          try {
            await spaceDetailService.addPlace(d, place.id);
            reached.push(d);
          } catch {
            failed.push(`${c.name} → ${destLabel(d)}`);
          }
        }
        done.push({name: c.name, where: reached.map(destLabel).join(' · ')});
      } catch {
        failed.push(c.name);
      }
    }
    setSaving(false);
    if (failed.length > 0) {
      Alert.alert(
        done.length > 0 ? 'Partly saved' : 'Could not save',
        `Saved ${done.length} of ${included.length}. These failed:\n${failed.join('\n')}`,
      );
    }
    if (done.length === 0) return;
    // Came from a space screen — return to it, as CreatePlace does.
    if (spaceId !== undefined) {
      navigation.goBack();
      return;
    }
    setSaved(done);
  };

  // ── Success ───────────────────────────────────────────────────────────────

  if (saved) {
    return (
      <SafeAreaView style={s.safe} edges={['top', 'bottom']}>
        <View style={s.successWrap}>
          <View style={s.successCheck}>
            <Text style={s.successCheckIcon}>✓</Text>
          </View>
          <Text style={s.title}>
            {saved.length} {saved.length === 1 ? 'place' : 'places'} saved
          </Text>
          <Text style={s.help}>Each one went where you put it.</Text>
          <ScrollView style={s.flex} contentContainerStyle={s.list}>
            {saved.map((p, i) => (
              <View key={i} style={s.sheetCard}>
                <Text style={s.sheetCardName}>{p.name}</Text>
                <Text style={s.sheetCardSub}>{p.where}</Text>
              </View>
            ))}
          </ScrollView>
          <TouchableOpacity style={s.primaryBtn} onPress={() => navigation.goBack()} activeOpacity={0.85}>
            <Text style={s.primaryBtnText}>Done</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Review list ───────────────────────────────────────────────────────────

  const footerOn = selecting ? selected.length > 0 : included.length > 0 && missing === 0 && !saving;
  const footerLabel = selecting
    ? selected.length > 0 ? `Add ${selected.length} selected to…` : 'Select places'
    : included.length === 0 ? 'Pick at least one place'
    : missing > 0 ? `Pick a destination for ${missing} ${missing === 1 ? 'place' : 'places'}`
    : `Save ${included.length} ${included.length === 1 ? 'place' : 'places'}`;
  const onFooter = () => {
    if (selecting) setSheet({kind: 'dest', idxs: selected});
    else handleSave();
  };

  const sheetIdxs = sheet?.kind === 'dest' ? sheet.idxs : [];
  const many = sheetIdxs.length > 1;

  return (
    <SafeAreaView style={s.safe} edges={['top']}>
      <View style={s.header}>
        <TouchableOpacity onPress={() => navigation.goBack()} hitSlop={12} style={s.headerSide}>
          <Text style={s.headerBackIcon}>‹</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>{selecting ? 'Select places' : 'Review places'}</Text>
        <TouchableOpacity
          onPress={() => { setSelecting(v => !v); setSelected([]); }}
          hitSlop={12}
          style={[s.headerSide, s.headerRight]}>
          <Text style={s.headerAction}>{selecting ? 'Cancel' : 'Select'}</Text>
        </TouchableOpacity>
      </View>

      <ScrollView style={s.flex} contentContainerStyle={s.body} showsVerticalScrollIndicator={false}>
        <View style={s.fromPill}>
          <Text style={s.fromPillText}>From your TikTok</Text>
        </View>
        <Text style={s.title}>Found {places.length} places</Text>
        <Text style={s.help}>
          {selecting
            ? 'Tap the places that go together, then add them to a space in one go.'
            : "Each place saves where its chips say. Tap the chips to change them, or Select to set several at once."}
        </Text>

        {selecting && (
          <View style={s.selectBar}>
            <Text style={s.selectCount}>{selected.length} selected</Text>
            <TouchableOpacity
              hitSlop={8}
              onPress={() => setSelected(selected.length === places.length ? [] : places.map((_, i) => i))}>
              <Text style={s.headerAction}>{selected.length === places.length ? 'Clear' : 'Select all'}</Text>
            </TouchableOpacity>
          </View>
        )}

        <View style={s.list}>
          {places.map((p, i) => {
            const r = rows[i];
            const c = candOf(i);
            const isSel = selected.includes(i);
            const checked = selecting ? isSel : r.included;
            return (
              <TouchableOpacity
                key={i}
                activeOpacity={selecting ? 0.75 : 1}
                disabled={!selecting}
                onPress={() => toggleSelected(i)}
                accessibilityState={selecting ? {selected: isSel} : undefined}
                style={[s.row, selecting && isSel && s.rowSelected, !selecting && !r.included && s.rowSkipped]}>
                <TouchableOpacity
                  style={s.rowCheckHit}
                  disabled={selecting}
                  onPress={() => toggleIncluded(i)}
                  accessibilityRole="checkbox"
                  accessibilityState={{checked}}
                  accessibilityLabel={`Include ${c.name}`}>
                  <CheckBox on={checked} />
                </TouchableOpacity>

                <View style={s.flex}>
                  <TouchableOpacity
                    disabled={selecting || p.candidates.length < 2}
                    onPress={() => setSheet({kind: 'match', idx: i})}>
                    <View style={s.nameRow}>
                      <Text style={s.rowName}>{c.name}</Text>
                      {!selecting && p.candidates.length > 1 && <Text style={s.swap}>⌄</Text>}
                    </View>
                    <View style={s.addrRow}>
                      <Pin size={11} color={colors.textSecondary} filled />
                      <Text style={s.rowAddr} numberOfLines={1}>{displayAddress(c.address) ?? c.address}</Text>
                    </View>
                  </TouchableOpacity>

                  {r.included ? (
                    <TouchableOpacity
                      style={s.chips}
                      disabled={selecting}
                      onPress={() => setSheet({kind: 'dest', idxs: [i]})}
                      accessibilityLabel={`Change where ${c.name} is saved`}>
                      {destOptions.filter(d => r.dests.includes(d.key)).map(d => (
                        <View key={String(d.key)} style={[s.chip, d.key === 'saved' ? s.chipSaved : s.chipSpace]}>
                          <Text style={[s.chipText, d.key === 'saved' ? s.chipSavedText : s.chipSpaceText]}>
                            {d.icon} {d.key === 'saved' ? 'Saved' : d.label}
                          </Text>
                        </View>
                      ))}
                      {r.dests.length === 0 && (
                        <View style={[s.chip, s.chipMissing]}>
                          <Text style={[s.chipText, s.chipMissingText]}>Pick a destination</Text>
                        </View>
                      )}
                      {!selecting && (
                        <View style={[s.chip, s.chipChange]}>
                          <Text style={[s.chipText, s.chipChangeText]}>＋ Change</Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  ) : (
                    <Text style={s.skipped}>Won't be saved</Text>
                  )}
                </View>
              </TouchableOpacity>
            );
          })}
        </View>

        {unmatched.length > 0 && (
          <Text style={s.unmatched}>
            Couldn't find {unmatched.join(', ')} on the map. Add {unmatched.length === 1 ? 'it' : 'them'} by hand.
          </Text>
        )}
      </ScrollView>

      <SafeAreaView edges={['bottom']} style={s.footer}>
        <TouchableOpacity
          style={[s.primaryBtn, !footerOn && s.primaryBtnOff]}
          disabled={!footerOn}
          onPress={onFooter}
          activeOpacity={0.85}>
          {saving
            ? <ActivityIndicator color="#fff" />
            : <Text style={[s.primaryBtnText, !footerOn && s.primaryBtnTextOff]}>{footerLabel}</Text>}
        </TouchableOpacity>
      </SafeAreaView>

      {/* Where should these go? One place, or several at once (tri-state). */}
      <Modal visible={sheet?.kind === 'dest'} animationType="slide" transparent onRequestClose={() => setSheet(null)}>
        <View style={s.sheetBackdrop}>
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>
              {many ? `Add ${sheetIdxs.length} places to…` : `Add ${sheetIdxs.length ? candOf(sheetIdxs[0]).name : ''} to…`}
            </Text>
            <Text style={s.sheetSub}>
              {many
                ? 'Adds to every selected place. Their other destinations stay as they are.'
                : 'Saved places and any number of spaces.'}
            </Text>
            <ScrollView style={s.sheetScroll}>
              {destOptions.map(d => {
                const n = sheetIdxs.filter(i => rows[i].dests.includes(d.key)).length;
                const state = n === 0 ? 'off' : n === sheetIdxs.length ? 'on' : 'partial';
                return (
                  <TouchableOpacity
                    key={String(d.key)}
                    style={s.destRow}
                    onPress={() => toggleDest(sheetIdxs, d.key)}
                    accessibilityRole="checkbox"
                    accessibilityState={{checked: state === 'partial' ? 'mixed' : state === 'on'}}
                    activeOpacity={0.7}>
                    <CheckBox on={state !== 'off'} partial={state === 'partial'} />
                    <Text style={s.destEmoji}>{d.icon}</Text>
                    <View style={s.flex}>
                      <Text style={s.destLabel}>{d.label}</Text>
                      {state === 'partial' && (
                        <Text style={s.sheetCardSub}>{n} of {sheetIdxs.length} already here</Text>
                      )}
                    </View>
                  </TouchableOpacity>
                );
              })}
              {spaces.length === 0 && <Text style={s.destEmpty}>You have no spaces yet.</Text>}
            </ScrollView>
            <TouchableOpacity style={s.primaryBtn} onPress={() => setSheet(null)} activeOpacity={0.85}>
              <Text style={s.primaryBtnText}>Done</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Which branch? Same picker as the single-place form. */}
      <Modal visible={sheet?.kind === 'match'} animationType="slide" transparent onRequestClose={() => setSheet(null)}>
        <View style={s.sheetBackdrop}>
          <View style={s.sheet}>
            <Text style={s.sheetTitle}>Which place is it?</Text>
            {sheet?.kind === 'match' && !!places[sheet.idx].evidence && (
              <Text style={s.sheetSub} numberOfLines={2}>{places[sheet.idx].evidence}</Text>
            )}
            <ScrollView style={s.sheetScroll}>
              {sheet?.kind === 'match' && places[sheet.idx].candidates.map((c, ci) => (
                <TouchableOpacity
                  key={c.google_place_id}
                  style={[s.sheetCard, rows[sheet.idx].cand === ci && s.sheetCardOn]}
                  onPress={() => {
                    const idx = sheet.idx;
                    setRows(prev => prev.map((r, j) => (j === idx ? {...r, cand: ci} : r)));
                    setSheet(null);
                  }}
                  activeOpacity={0.75}>
                  <Text style={s.sheetCardName}>{c.name}</Text>
                  <Text style={s.sheetCardSub} numberOfLines={2}>{c.address}</Text>
                </TouchableOpacity>
              ))}
            </ScrollView>
            <TouchableOpacity style={s.sheetSecondary} onPress={() => setSheet(null)}>
              <Text style={s.sheetSecondaryText}>Cancel</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

function CheckBox({on, partial}: {on: boolean; partial?: boolean}) {
  return (
    <View style={[s.check, on && s.checkOn]}>
      {on && <Text style={s.checkMark}>{partial ? '–' : '✓'}</Text>}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
// Lifted from CreatePlaceScreen so the two flows read as one.

const s = StyleSheet.create({
  safe: {flex: 1, backgroundColor: colors.background},
  flex: {flex: 1},

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    paddingVertical: 12,
    backgroundColor: colors.background,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerSide: {minWidth: 56, justifyContent: 'center'},
  headerRight: {alignItems: 'flex-end'},
  headerBackIcon: {fontSize: 30, color: colors.primary, lineHeight: 34},
  headerTitle: {fontFamily: fonts.bold, fontSize: 16, color: colors.text},
  headerAction: {fontFamily: fonts.bold, fontSize: 14, color: colors.primary},

  body: {padding: spacing.md, paddingTop: 18, paddingBottom: spacing.lg},
  fromPill: {alignSelf: 'flex-start', borderRadius: 999, paddingVertical: 4, paddingHorizontal: 9, backgroundColor: colors.primaryLight, marginBottom: 6},
  fromPillText: {fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.7, textTransform: 'uppercase', color: colors.primaryDeep},
  title: {fontFamily: fonts.bold, fontSize: 24, letterSpacing: -0.5, color: colors.text},
  help: {fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, color: colors.textSecondary, marginTop: 6, marginBottom: 18},

  selectBar: {flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10},
  selectCount: {fontFamily: fonts.bold, fontSize: 11, letterSpacing: 0.7, color: colors.textSecondary, textTransform: 'uppercase'},

  list: {gap: 10},
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderWidth: 2,
    borderColor: 'transparent',
    shadowColor: '#14141E',
    shadowOffset: {width: 0, height: 1},
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  rowSelected: {borderColor: colors.primary},
  rowSkipped: {opacity: 0.55},
  rowCheckHit: {width: 44, height: 44, margin: -11, alignItems: 'center', justifyContent: 'center'},
  nameRow: {flexDirection: 'row', alignItems: 'center', gap: 6},
  rowName: {flexShrink: 1, fontFamily: fonts.semibold, fontSize: 15, color: colors.text},
  swap: {fontFamily: fonts.bold, fontSize: 14, color: colors.textSecondary, marginTop: -6},
  addrRow: {flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 3},
  rowAddr: {flex: 1, fontFamily: fonts.regular, fontSize: 11.5, color: colors.textSecondary},

  chips: {flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8},
  chip: {borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10},
  chipText: {fontFamily: fonts.semibold, fontSize: 12},
  chipSaved: {backgroundColor: colors.primaryLight},
  chipSavedText: {color: colors.primaryDeep},
  chipSpace: {backgroundColor: colors.accentSoftB},
  chipSpaceText: {color: colors.accent},
  chipMissing: {backgroundColor: colors.errorLight},
  chipMissingText: {color: colors.error},
  chipChange: {borderWidth: 1, borderStyle: 'dashed', borderColor: colors.ringIdle, paddingVertical: 4, paddingHorizontal: 8},
  chipChangeText: {color: colors.textSecondary},
  skipped: {fontFamily: fonts.semibold, fontSize: 12, color: colors.textSecondary, marginTop: 8},
  unmatched: {fontFamily: fonts.regular, fontSize: 12, lineHeight: 17, color: colors.textSecondary, marginTop: spacing.md},

  footer: {
    backgroundColor: colors.background,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  primaryBtn: {backgroundColor: colors.primary, borderRadius: radius.lg, minHeight: 48, alignItems: 'center', justifyContent: 'center'},
  primaryBtnOff: {backgroundColor: colors.disabledBg},
  primaryBtnText: {fontFamily: fonts.bold, fontSize: 15, color: colors.white},
  primaryBtnTextOff: {color: colors.disabledFg},

  sheetBackdrop: {flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'flex-end'},
  sheet: {backgroundColor: colors.background, borderTopLeftRadius: 20, borderTopRightRadius: 20, paddingHorizontal: 20, paddingTop: 22, paddingBottom: 34, maxHeight: '88%'},
  sheetTitle: {fontFamily: fonts.bold, fontSize: 16, color: colors.text, marginBottom: 6},
  sheetSub: {fontFamily: fonts.regular, fontSize: 11.5, lineHeight: 17, color: colors.textSecondary, marginBottom: 16},
  sheetScroll: {marginBottom: spacing.md},
  sheetSecondary: {alignItems: 'center', justifyContent: 'center', minHeight: 48, borderRadius: radius.lg, backgroundColor: colors.surface, marginTop: 10},
  sheetSecondaryText: {fontFamily: fonts.bold, fontSize: 15, color: colors.text},
  sheetCard: {backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: 13, paddingHorizontal: 14, marginBottom: 10, borderWidth: 2, borderColor: 'transparent'},
  sheetCardOn: {borderColor: colors.primary},
  sheetCardName: {fontFamily: fonts.semibold, fontSize: 13.5, color: colors.text},
  sheetCardSub: {fontFamily: fonts.regular, fontSize: 11.5, color: colors.textSecondary, marginTop: 3},

  destRow: {flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: 10, paddingHorizontal: 12, minHeight: 52, marginBottom: 10},
  destEmoji: {fontSize: 17},
  destLabel: {fontFamily: fonts.semibold, fontSize: 13.5, color: colors.text},
  destEmpty: {fontFamily: fonts.regular, fontSize: 14, color: colors.textMuted, paddingVertical: spacing.md},

  check: {width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.ringIdle, alignItems: 'center', justifyContent: 'center'},
  checkOn: {backgroundColor: colors.primary, borderColor: colors.primary},
  checkMark: {fontFamily: fonts.bold, fontSize: 12, color: colors.white},

  successWrap: {flex: 1, paddingHorizontal: spacing.lg, paddingTop: 72, paddingBottom: spacing.md},
  successCheck: {width: 64, height: 64, borderRadius: 32, backgroundColor: colors.success, alignItems: 'center', justifyContent: 'center', marginBottom: 20},
  successCheckIcon: {fontFamily: fonts.bold, fontSize: 28, color: colors.white},
});
