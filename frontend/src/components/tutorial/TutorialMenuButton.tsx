'use client';

import { useState } from 'react';
import { BookOpen } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { TutorialMenu } from './integration/TutorialMenu';
import { allTutorials } from '@/data/tutorials';

/**
 * Floating tutorial menu button
 *
 * Provides easy access to all available tutorials from anywhere in the app.
 * Displays as a fixed position button in the bottom-right corner.
 */
export function TutorialMenuButton() {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <>
      {/* Floating Tutorial Button */}
      <Button
        onClick={() => setIsOpen(true)}
        className="fixed bottom-6 right-6 h-14 w-14 rounded-full shadow-lg z-40"
        size="icon"
        title="View Tutorials"
        aria-label="Open tutorial menu"
      >
        <BookOpen className="h-6 w-6" />
      </Button>

      {/* Tutorial Menu Dialog */}
      <TutorialMenu
        tutorials={allTutorials}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
      />
    </>
  );
}
