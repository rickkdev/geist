import React from 'react';
import Svg, { Path } from 'react-native-svg';

interface HamburgerIconProps {
  size?: number;
  color?: string;
}

export default function HamburgerIcon({ 
  size = 24, 
  color = '#374151'
}: HamburgerIconProps) {
  return (
    <Svg 
      width={size} 
      height={size} 
      viewBox="0 0 24 24" 
      fill="none"
    >
      <Path
        d="M3.75 9h16.5m-16.5 6.75h16.5"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}