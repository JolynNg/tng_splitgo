import React from 'react';
import { View } from 'react-native';
import Svg, { Circle, Path } from 'react-native-svg';
import { SG } from '../tokens';

export default function TngAvatar({ size = 32, onWhite = true }) {
  const iconSize = size * 0.55;
  return (
    <View style={{
      width: size,
      height: size,
      borderRadius: size / 2,
      backgroundColor: onWhite ? SG.primarySoft : 'rgba(255,255,255,0.22)',
      alignItems: 'center',
      justifyContent: 'center',
    }}>
      <Svg width={iconSize} height={iconSize} viewBox="0 0 22 22" fill="none">
        <Circle cx="11" cy="8" r="3.5" stroke={onWhite ? SG.primary : '#fff'} strokeWidth="1.6" />
        <Path
          d="M4 18c1-3 4-4.5 7-4.5s6 1.5 7 4.5"
          stroke={onWhite ? SG.primary : '#fff'}
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </Svg>
    </View>
  );
}
