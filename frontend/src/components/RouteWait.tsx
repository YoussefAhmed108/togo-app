import React, {useEffect, useRef} from 'react';
import {AccessibilityInfo, ActivityIndicator, Animated, Easing, StyleSheet, Text, View} from 'react-native';
import {colors, fonts} from '../theme';

/**
 * The TikTok wait, as the logo's route: the W draws itself while a small video
 * rides it, and each stop lights up as its stage begins.
 *
 * Driven by the real stage (the parent's timer), not a free-running loop, so
 * the route never finishes before the work does — it eases toward the next
 * stop and waits there.
 */

const STAGES = ['Reading the video', 'Finding the place', 'Matching it on the map'];

const BOX = 260; // drawing size in pt; the route lives in a 100-unit box
const U = BOX / 100;
const STROKE = 9 * U;
const ROUTE: Array<[number, number]> = [[16, 30], [33, 72], [50, 42], [67, 72], [84, 30]];

const LENGTHS = ROUTE.slice(1).map(([x, y], i) => Math.hypot(x - ROUTE[i][0], y - ROUTE[i][1]));
const TOTAL = LENGTHS.reduce((a, b) => a + b, 0);
/** Where each route point sits along the path, 0..1. */
const AT = LENGTHS.reduce<number[]>((acc, len) => [...acc, acc[acc.length - 1] + len / TOTAL], [0]);

// How far along the route each stage travels. Stage 1 starts at the middle stop.
const TARGET = [AT[2] - 0.03, AT[4] - 0.04, 1];

export function RouteWait({stage}: {stage: number}) {
  const progress = useRef(new Animated.Value(0)).current;
  const pops = useRef(ROUTE.map(() => new Animated.Value(0))).current;
  const ring = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let reduce = false;
    AccessibilityInfo.isReduceMotionEnabled().then(v => {
      reduce = v;
    });
    const stopIndex = [0, 2, 4][Math.min(stage, 2)];
    const run = Animated.parallel([
      // Travel toward this stage's stop: slow, and it settles rather than arriving.
      Animated.timing(progress, {
        toValue: TARGET[Math.min(stage, 2)],
        duration: reduce ? 0 : stage === 2 ? 1400 : 5600,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: false,
      }),
      // The stop this stage starts from lands with a small overshoot.
      Animated.spring(pops[stopIndex], {toValue: 1, friction: 4, tension: 120, useNativeDriver: false}),
    ]);
    run.start();

    if (stage < 2) return () => run.stop();
    // The destination pulses while the last stage finishes.
    const pulse = Animated.loop(
      Animated.timing(ring, {toValue: 1, duration: 1400, easing: Easing.out(Easing.quad), useNativeDriver: false}),
    );
    pulse.start();
    return () => {
      run.stop();
      pulse.stop();
    };
  }, [stage, progress, pops, ring]);

  // The rider follows the polyline: piecewise-linear over the route points.
  const riderX = progress.interpolate({inputRange: AT, outputRange: ROUTE.map(([x]) => x * U - 17)});
  const riderY = progress.interpolate({inputRange: AT, outputRange: ROUTE.map(([, y]) => y * U - 23)});
  const barWidth = progress.interpolate({inputRange: [0, 1], outputRange: ['4%', '100%']});

  const dot = (i: number, r: number, color: string, pop: Animated.Value) => {
    const [x, y] = ROUTE[i];
    return (
      <Animated.View
        key={`${i}-${r}`}
        style={[
          s.abs,
          {
            left: x * U - r * U,
            top: y * U - r * U,
            width: 2 * r * U,
            height: 2 * r * U,
            borderRadius: r * U,
            backgroundColor: color,
            transform: [{scale: pop}],
          },
        ]}
      />
    );
  };

  return (
    <View style={s.wrap}>
      <View style={s.drawing}>
        {/* Base route, then the drawn part growing over it segment by segment. */}
        {ROUTE.slice(1).map(([x2, y2], i) => {
          const [x1, y1] = ROUTE[i];
          const angle = (Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI;
          const full = LENGTHS[i] * U;
          const base = {
            left: x1 * U - STROKE / 2,
            top: y1 * U - STROKE / 2,
            height: STROKE,
            borderRadius: STROKE / 2,
            transformOrigin: [STROKE / 2, STROKE / 2, 0] as [number, number, number],
            transform: [{rotate: `${angle}deg`}],
          };
          const drawn = progress.interpolate({
            inputRange: [AT[i], AT[i + 1]],
            outputRange: [STROKE, full + STROKE],
            extrapolate: 'clamp',
          });
          return (
            <React.Fragment key={i}>
              <View style={[s.abs, s.track, base, {width: full + STROKE}]} />
              <Animated.View style={[s.abs, s.teal, base, {width: drawn}]} />
            </React.Fragment>
          );
        })}

        {dot(0, 8, colors.primary, pops[0])}
        {dot(2, 8, colors.primary, pops[2])}
        <Animated.View
          style={[
            s.abs,
            s.ring,
            {
              left: 84 * U - 17 * U,
              top: 30 * U - 17 * U,
              width: 34 * U,
              height: 34 * U,
              borderRadius: 17 * U,
              opacity: ring.interpolate({inputRange: [0, 0.2, 1], outputRange: [0, 0.5, 0]}),
              transform: [{scale: ring.interpolate({inputRange: [0, 1], outputRange: [0.6, 1.8]})}],
            },
          ]}
        />
        {dot(4, 11, '#DBDBFF', pops[4])}
        {dot(4, 4.5, '#6A69DB', pops[4])}

        {/* The video, riding the route */}
        <Animated.View style={[s.rider, {transform: [{translateX: riderX}, {translateY: riderY}]}]}>
          <View style={s.play} />
        </Animated.View>
      </View>

      <Text style={s.title}>Analysing TikTok…</Text>
      <View style={s.bar}>
        <Animated.View style={[s.barFill, {width: barWidth}]} />
      </View>
      <View style={s.stages}>
        {STAGES.map((label, i) => (
          <View key={label} style={s.stageRow}>
            <View style={[s.stageDot, i < stage && s.stageDone, i === stage && s.stageNow]}>
              {i < stage ? (
                <Text style={s.tick}>✓</Text>
              ) : i === stage ? (
                <ActivityIndicator size="small" color={colors.primary} style={s.spinner} />
              ) : null}
            </View>
            <Text style={[s.stageText, i === stage && s.stageTextOn]}>{label}</Text>
          </View>
        ))}
      </View>
      <Text style={s.note}>This usually takes about 20 seconds.</Text>
    </View>
  );
}

const s = StyleSheet.create({
  wrap: {paddingHorizontal: 32},
  drawing: {width: BOX, height: BOX * 0.8, alignSelf: 'center', marginBottom: 20},
  abs: {position: 'absolute'},
  track: {backgroundColor: colors.border},
  teal: {backgroundColor: colors.primary},
  ring: {backgroundColor: '#6A69DB'},
  rider: {
    position: 'absolute',
    left: 0,
    top: 0,
    width: 34,
    height: 46,
    borderRadius: 9,
    backgroundColor: colors.text,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#14141E',
    shadowOffset: {width: 0, height: 8},
    shadowOpacity: 0.28,
    shadowRadius: 12,
    elevation: 6,
  },
  // A play triangle from borders.
  play: {
    width: 0,
    height: 0,
    marginLeft: 3,
    borderTopWidth: 7,
    borderBottomWidth: 7,
    borderLeftWidth: 11,
    borderTopColor: 'transparent',
    borderBottomColor: 'transparent',
    borderLeftColor: colors.white,
  },
  title: {fontFamily: fonts.bold, fontSize: 22, letterSpacing: -0.4, color: colors.text},
  bar: {height: 4, borderRadius: 2, backgroundColor: colors.border, overflow: 'hidden', marginTop: 20, marginBottom: 22},
  barFill: {height: '100%', borderRadius: 2, backgroundColor: colors.primary},
  stages: {gap: 16},
  stageRow: {flexDirection: 'row', alignItems: 'center', gap: 12},
  stageDot: {
    width: 20,
    height: 20,
    borderRadius: 10,
    borderWidth: 2,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stageNow: {borderColor: 'transparent'},
  stageDone: {backgroundColor: colors.success, borderColor: colors.success},
  spinner: {transform: [{scale: 0.8}]},
  tick: {fontFamily: fonts.bold, fontSize: 10, color: colors.white},
  stageText: {fontFamily: fonts.medium, fontSize: 14, color: colors.textSecondary},
  stageTextOn: {fontFamily: fonts.bold, color: colors.text},
  note: {fontFamily: fonts.regular, fontSize: 12, color: colors.textSecondary, marginTop: 28},
});
