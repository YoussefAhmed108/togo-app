import React, {useEffect, useRef} from 'react';
import {AccessibilityInfo, Animated, Easing, View} from 'react-native';
import {colors, themedStyles} from '../theme';

/**
 * The app's loading state: the logo's route draws itself, the destination
 * lands, then it fades and draws again. Same geometry as RouteWait, looping.
 */

const ROUTE: Array<[number, number]> = [[16, 30], [33, 72], [50, 42], [67, 72], [84, 30]];
const LENGTHS = ROUTE.slice(1).map(([x, y], i) => Math.hypot(x - ROUTE[i][0], y - ROUTE[i][1]));
const TOTAL = LENGTHS.reduce((a, b) => a + b, 0);
const AT = LENGTHS.reduce<number[]>((acc, len) => [...acc, acc[acc.length - 1] + len / TOTAL], [0]);

export function WaypointLoader({size = 96, style}: {size?: number; style?: object}) {
  const progress = useRef(new Animated.Value(0)).current;
  const fade = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    let loop: Animated.CompositeAnimation | undefined;
    AccessibilityInfo.isReduceMotionEnabled().then(reduce => {
      if (reduce) {
        progress.setValue(1);
        return;
      }
      loop = Animated.loop(
        Animated.sequence([
          Animated.timing(progress, {toValue: 1, duration: 1100, easing: Easing.inOut(Easing.cubic), useNativeDriver: false}),
          Animated.delay(350),
          Animated.timing(fade, {toValue: 0, duration: 280, useNativeDriver: false}),
          Animated.parallel([
            Animated.timing(progress, {toValue: 0, duration: 0, useNativeDriver: false}),
            Animated.timing(fade, {toValue: 1, duration: 0, useNativeDriver: false}),
          ]),
        ]),
      );
      loop.start();
    });
    return () => loop?.stop();
  }, [progress, fade]);

  const U = size / 100;
  const STROKE = 9 * U;
  const headX = progress.interpolate({inputRange: AT, outputRange: ROUTE.map(([x]) => x * U - STROKE)});
  const headY = progress.interpolate({inputRange: AT, outputRange: ROUTE.map(([, y]) => y * U - STROKE)});
  const land = progress.interpolate({inputRange: [0, 0.94, 1], outputRange: [0, 0, 1], extrapolate: 'clamp'});

  const dot = (x: number, y: number, r: number, color: string, extra?: object) => (
    <Animated.View
      style={[
        s.abs,
        {left: x * U - r * U, top: y * U - r * U, width: 2 * r * U, height: 2 * r * U, borderRadius: r * U, backgroundColor: color},
        extra,
      ]}
    />
  );

  return (
    <View
      style={[{width: size, height: size * 0.8, alignSelf: 'center'}, style]}
      accessibilityRole="progressbar"
      accessibilityLabel="Loading">
      <View style={{position: 'absolute', left: 0, right: 0, top: -12 * U, bottom: 0}}>
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
              <Animated.View style={[s.abs, s.teal, base, {width: drawn, opacity: fade}]} />
            </React.Fragment>
          );
        })}
        {dot(16, 30, 8, colors.primary, {opacity: fade})}
        {dot(84, 30, 11, '#DBDBFF', {opacity: fade, transform: [{scale: land}]})}
        {dot(84, 30, 4.5, '#6A69DB', {opacity: fade, transform: [{scale: land}]})}
        {/* The traveller at the tip of the line */}
        <Animated.View
          style={[
            s.abs,
            s.head,
            {
              width: 2 * STROKE,
              height: 2 * STROKE,
              borderRadius: STROKE,
              borderWidth: Math.max(2, 2.5 * U),
              opacity: fade,
              transform: [{translateX: headX}, {translateY: headY}],
            },
          ]}
        />
      </View>
    </View>
  );
}

/** Full-screen centred loader. */
export function ScreenLoader({style}: {style?: object}) {
  return (
    <View style={[s.screen, style]}>
      <WaypointLoader />
    </View>
  );
}

const s = themedStyles(() => ({
  abs: {position: 'absolute'},
  track: {backgroundColor: colors.border},
  teal: {backgroundColor: colors.primary},
  head: {left: 0, top: 0, backgroundColor: colors.surface, borderColor: colors.primary},
  screen: {flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background},
}));
