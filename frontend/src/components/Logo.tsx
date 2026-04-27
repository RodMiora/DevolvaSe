import React from 'react';
import { cn } from '@/lib/utils';

export default function Logo({ className, showText = true }: { className?: string, showText?: boolean }) {
  return (
    <div className={cn("flex items-center gap-2", className)}>
      {/* Equalizer SVG Icon */}
      <svg 
        width="32" 
        height="24" 
        viewBox="0 0 32 24" 
        fill="none" 
        xmlns="http://www.w3.org/2000/svg"
        className="w-8 h-6"
      >
        {/* 7 Bars - Fiel ao Mockup */}
        <rect x="0" y="14" width="3" height="4" rx="1" fill="#22c55e">
          <animate attributeName="height" values="4;10;4" dur="1.2s" repeatCount="indefinite" />
          <animate attributeName="y" values="14;8;14" dur="1.2s" repeatCount="indefinite" />
        </rect>
        <rect x="4" y="10" width="3" height="8" rx="1" fill="#22c55e">
          <animate attributeName="height" values="8;14;8" dur="0.9s" repeatCount="indefinite" />
          <animate attributeName="y" values="10;4;10" dur="0.9s" repeatCount="indefinite" />
        </rect>
        <rect x="8" y="7" width="3" height="12" rx="1" fill="#eab308">
          <animate attributeName="height" values="12;18;12" dur="1.4s" repeatCount="indefinite" />
          <animate attributeName="y" values="7;1;7" dur="1.4s" repeatCount="indefinite" />
        </rect>
        <rect x="12" y="5" width="3" height="15" rx="1" fill="#eab308">
          <animate attributeName="height" values="15;22;15" dur="1.1s" repeatCount="indefinite" />
          <animate attributeName="y" values="5;0;5" dur="1.1s" repeatCount="indefinite" />
        </rect>
        <rect x="16" y="8" width="3" height="10" rx="1" fill="#f97316">
          <animate attributeName="height" values="10;16;10" dur="1.3s" repeatCount="indefinite" />
          <animate attributeName="y" values="8;2;8" dur="1.3s" repeatCount="indefinite" />
        </rect>
        <rect x="20" y="11" width="3" height="6" rx="1" fill="#f97316">
          <animate attributeName="height" values="6;12;6" dur="0.8s" repeatCount="indefinite" />
          <animate attributeName="y" values="11;5;11" dur="0.8s" repeatCount="indefinite" />
        </rect>
        <rect x="24" y="13" width="3" height="4" rx="1" fill="#ef4444">
          <animate attributeName="height" values="4;8;4" dur="1.5s" repeatCount="indefinite" />
          <animate attributeName="y" values="13;9;13" dur="1.5s" repeatCount="indefinite" />
        </rect>
      </svg>
      
      {showText && (
        <h1 className="text-2xl font-bold tracking-tight font-sans flex items-center">
          <span className="text-white">Devolva</span>
          <span 
            className="bg-clip-text text-transparent bg-gradient-to-r from-[#f97316] to-[#ef4444]"
          >
            Se
          </span>
        </h1>
      )}
    </div>
  );
}
