import { Tutorial } from '@/types/tutorial';

/**
 * Civ 6 Early Game Tutorial
 *
 * Teaches players how to automate the critical opening moves in Civilization VI,
 * allowing them to focus on strategy while Qontinui handles the repetitive
 * unit management and settler placement.
 *
 * This tutorial progresses from understanding the problem, through capturing
 * the game state, identifying UI elements, creating actions, and finally
 * building and testing a complete automation sequence.
 */
export const civ6EarlyGameTutorial: Tutorial = {
  id: 'civ6-early-game',
  title: 'Automate Your Civ 6 Early Game',
  description:
    'Master your opening moves while Qontinui handles the micro-management. Learn to automate unit selection, settler movement, and city founding in Civilization VI.',
  duration: '15 minutes',
  difficulty: 'beginner',
  category: 'Gaming',
  tags: ['civ6', 'strategy', 'automation', 'gaming', 'turn-based'],

  learningObjectives: [
    'Understand the value of automating repetitive early game tasks',
    'Identify key UI elements in Civ 6 that enable automation',
    'Create actions that interact with game UI',
    'Test and verify automation sequences work correctly',
    'Troubleshoot automation failures and adapt to game state changes',
  ],

  author: {
    name: 'Qontinui Team',
  },

  metadata: {
    createdAt: Date.now(),
    updatedAt: Date.now(),
    version: '1.0.0',
  },

  isPublished: true,

  steps: [
    {
      id: 'step-1-introduction',
      title: 'Why Automate Early Game?',
      content: `
# The Civ 6 Early Game Challenge

Civilization VI's early game is *repetitive but critical*. In your first 50 turns, you're constantly:

- **Cycling through units** to find the settler with the "!" indicator
- **Moving settlers** to optimal positions for city placement
- **Positioning military units** for defense
- **Ending turns** after reviewing each action

Each decision matters for your empire's trajectory, but the execution is tedious—the perfect task for automation.

## Why This Matters

By automating these repetitive actions, you:

1. **Focus on strategy** - Decide *where* cities should go, not *how* to move settlers
2. **Eliminate errors** - No more accidentally moving the wrong unit
3. **Play faster** - Finish multiple turns while unit micro-management runs
4. **Reduce fatigue** - Less repetitive clicking means better strategic thinking
5. **Adapt on the fly** - Pause and adjust if something unexpected happens

## What You'll Learn

In this tutorial, you'll:
- Capture your game state with screenshots
- Identify the UI elements Qontinui uses to interact with the game
- Create a sequence of automated actions
- Test and refine your automation
- Handle variations and edge cases

**Let's automate your way to a stronger opening!**
`,
      estimatedDuration: 2,
      difficulty: 'beginner',
      learningObjectives: [
        'Understand the problem automation solves',
        'See how model-based automation differs from traditional approaches',
        'Understand the workflow for creating game automation',
      ],
      tips: [
        'Think about which early game tasks are most tedious for you',
        'Consider edge cases: What if a settler dies? What if you need to adjust strategy mid-automation?',
        'Civ 6 automation is ideal because the game pauses while you think—no reaction time pressure',
      ],
      resources: [
        {
          title: 'Qontinui Documentation',
          url: 'https://docs.qontinui.io',
          type: 'documentation',
        },
        {
          title: 'Model-Based Automation Explained',
          url: 'https://docs.qontinui.io/concepts/model-based',
          type: 'article',
        },
      ],
    },

    {
      id: 'step-2-upload-screenshots',
      title: 'Upload Your Game Screenshots',
      content: `
# Capturing Your Game State

To automate your Civ 6 early game, Qontinui first needs to understand *what your game looks like*. We do this by analyzing your screenshots.

## What to Screenshot

You'll need screenshots of key game states:

### Required Screenshots:
1. **Main game screen** - Your empire's current state (after settling your first city)
2. **Unit selected** - A settler or warrior selected (shows "!" indicator and selection highlight)
3. **Strategic view** - The zoomed-out map view (press 'V' in Civ 6)
4. **City founding** - A settler at a settlement site, ready to found

### Tips for Good Screenshots:

- **Avoid clutter** - Close any tooltips or UI overlays
- **Clear focus** - Make sure the important elements are visible and not hidden
- **Consistent settings** - Use the same game settings/resolution for all screenshots
- **Include HUD** - Keep the game's interface visible (we need to see buttons and indicators)
- **Full size** - Capture the entire game window, not just portions

## How to Capture

1. **In-game screenshot**:
   - Play Civ 6 normally and get to a key moment
   - Press the game's screenshot key or use your OS screenshot tool
   - Save to a known location

2. **Organize your files**:
   - Use descriptive names: \`civ6-settler-selected.png\`, \`civ6-strategic-view.png\`
   - Create a folder for easy upload

3. **Upload in this step**:
   - We'll provide an upload tool next

**Pro tip**: Take screenshots at different resolutions and window sizes—Qontinui can learn patterns even when the UI layout varies slightly.
`,
      estimatedDuration: 3,
      difficulty: 'beginner',
      learningObjectives: [
        'Understand what makes a good screenshot for automation',
        'Know how to capture game state effectively',
        'Organize screenshots for model training',
      ],
      tryIt: {
        type: 'upload-screenshots',
        component: 'ScreenshotUploader',
        hints: [
          'Start with a settler that has been selected',
          'Include both normal and strategic views',
          'Make sure the "!" indicator is visible on selected units',
        ],
        successCriteria: {
          description: 'Upload at least 2 relevant Civ 6 screenshots showing different game states',
          validation: {
            minScreenshots: 2,
            format: 'png or jpg',
          },
        },
      },
      tips: [
        'If you don\'t have a Civ 6 game in progress, you can download sample screenshots from our gallery',
        'The more diverse your screenshots (different units, map zoom levels, UI states), the better Qontinui can adapt',
        'You can always add more screenshots later to improve accuracy',
      ],
    },

    {
      id: 'step-3-find-unit-toggle',
      title: 'Find the Unit Toggle Button',
      content: `
# Understanding the "!" Button

In Civ 6, the **"!" indicator** is crucial. It marks units that have:
- Just been produced
- Not yet been moved this turn
- Pending an action

When a settler has a "!", it needs assignment. When a warrior has a "!", it might need positioning.

## Where to Find It

The "!" appears:
- **On the unit's icon** in the unit portrait (bottom-left of screen or in unit panel)
- **On the unit itself** in the map view (small icon above the unit)
- **In the unit list** (if using unit cycling)

## Why We Target This

The key to automation: **We can cycle through units looking for the "!" indicator**.

When we find it:
1. We know which unit needs attention
2. We can take appropriate action (move settler, position warrior, etc.)
3. We repeat until no units have "!"

## Your Task

Identify where the "!" appears in your screenshots:
- Look at the unit portraits
- Note the button or icon that represents unit cycling
- Remember the screen coordinates for later

**In the next step, we'll click this button to select units with pending actions.**
`,
      screenshot: '/tutorials/civ6/step3-unit-toggle.png',
      annotations: [
        {
          type: 'highlight',
          x: 30,
          y: 650,
          width: 100,
          height: 60,
          label: 'Unit portrait area\nLook for "!" indicator here',
        },
        {
          type: 'arrow',
          x: 50,
          y: 680,
          label: 'Click to cycle units',
        },
        {
          type: 'highlight',
          x: 100,
          y: 200,
          width: 50,
          height: 50,
          label: 'Unit on map\n"!" appears here too',
        },
      ],
      estimatedDuration: 2,
      difficulty: 'beginner',
      learningObjectives: [
        'Understand how Civ 6 uses the "!" to mark pending units',
        'Locate the unit cycling UI',
        'Learn how to identify unit selection states',
      ],
      tryIt: {
        type: 'identify-element',
        component: 'ElementHighlighter',
        preloadedData: {
          elementName: 'Unit Toggle Button ("!")',
          elementDescription:
            'The button or icon that shows pending units (marked with "!")',
        },
        hints: [
          'Look at the unit portraits in your screenshot',
          'The "!" usually appears as a small exclamation mark overlay',
          'It\'s often near the unit\'s portrait or in the unit list',
          'Try looking at the bottom-left corner where unit info typically displays',
        ],
        successCriteria: {
          description: 'Successfully highlight the UI element representing unit selection state',
          validation: {
            minAnnotations: 1,
            annotationTypes: ['highlight', 'arrow'],
          },
        },
      },
      tips: [
        'In some UI layouts, the "!" might be subtle—look for a badge or number',
        'If you\'re unsure, zoom in on your screenshot to see details better',
        'Civ 6\'s UI can vary based on settings, so look for the most prominent unit indicator',
      ],
    },

    {
      id: 'step-4-select-settler',
      title: 'Create Action: Select Settler with "!"',
      content: `
# Automating Unit Selection

Now we'll create an action that **cycles through units until finding a settler with the "!" indicator**.

## The Action Sequence

Here's what we want to automate:

\`\`\`
1. Look at the screen
2. Is there a settler with "!" visible?
   → YES: Stop (we found it!)
   → NO: Continue
3. Click the unit cycle button
4. Go back to step 1
\`\`\`

## Model-Based Automation Magic

Instead of hardcoding "click coordinate X,Y", Qontinui uses pattern matching:

- **Understand the goal**: "Find a settler with the '!' indicator"
- **Look for visual patterns**: The settler unit icon + the "!" badge
- **Adapt to changes**: Works even if UI shifts slightly or game is zoomed differently
- **Stop when done**: Recognizes success condition and halts

## Your Action

You'll create this action by:

1. **Describing the goal**: "Select settler with pending action"
2. **Showing examples**: Upload screenshots showing:
   - Before (settler not visible or doesn't have "!")
   - After (settler selected with "!" showing)
3. **Teaching the pattern**: Let Qontinui learn what "settler with !" looks like
4. **Testing**: Verify it works in your game

## Why This Matters

This is the *first step* in every turn:
- We find the settler that needs direction
- We set it up for movement in the next step
- Without this, we can't automate anything else

**This is where Qontinui's model-based approach shines**—it understands *intent* (find settler), not just pixel coordinates.
`,
      estimatedDuration: 3,
      difficulty: 'beginner',
      learningObjectives: [
        'Understand how to create actions in Qontinui',
        'Learn the difference between coordinate-based and pattern-based automation',
        'Practice describing automation goals clearly',
        'See how actions can be composed into larger workflows',
      ],
      tryIt: {
        type: 'create-action',
        component: 'ActionBuilder',
        preloadedData: {
          actionName: 'Select Settler with Pending Action',
          actionDescription:
            'Find and select a settler that has the "!" indicator (not yet moved this turn)',
          goalScreenshots: [],
          actionType: 'unit-selection',
        },
        hints: [
          'Think about what "success" looks like: settler is selected and visible',
          'Consider the stopping condition: when should this action stop trying?',
          'What if all settlers have been moved? (This is an edge case to handle)',
          'Use your uploaded screenshots to show before/after states',
        ],
        successCriteria: {
          description:
            'Create an action that can find and select a settler with the "!" indicator',
          validation: {
            hasActionName: true,
            hasDescription: true,
            minExamples: 1,
          },
        },
      },
      tips: [
        'Keep your action focused: just select the settler, nothing else',
        'Consider renaming this action to "Select Next Settler" for clarity',
        'Think about what should happen if all settlers are already moved—add error handling',
      ],
    },

    {
      id: 'step-5-toggle-map-view',
      title: 'Toggle Map View & Find Settlement Site',
      content: `
# Switching to Strategic View

Once we've selected a settler, the next logical step is to **move it to its destination**. But first, we need to see the big picture.

## Why Strategic View?

Civ 6's strategic view (press 'V'):
- **Shows terrain more clearly** - You can see hills, rivers, and resources better
- **Reduces clutter** - Units and buildings are simplified, easier to identify
- **Better for planning** - Easier to spot good city locations
- **Familiar pattern** - Many Civ 6 players use strategic view for this reason

## The Toggle Action

We need an action that:
1. **Checks current view** - Are we in strategic view already?
2. **Toggles if needed** - Press the view toggle key/button
3. **Waits for transition** - Strategic view takes a moment to render
4. **Confirms success** - Verify we're now in strategic view

## Finding Settlement Sites

Once in strategic view, we identify where the settler should go:
- **High production land** - Hills, forests, river access
- **Strategic resources** - Especially early game (copper, tin, iron)
- **Defense** - Elevated terrain when possible
- **Distance from other cities** - Usually 4-6 tiles away for optimal culture/production

## Your Task

Create an action that:
1. Toggles to strategic view
2. Waits for the transition
3. Confirms the map is now visible

**This is preparation for the next step—moving the settler.**
`,
      screenshot: '/tutorials/civ6/step5-strategic-view.png',
      annotations: [
        {
          type: 'highlight',
          x: 100,
          y: 100,
          width: 800,
          height: 600,
          label: 'Strategic view\nSimplified terrain, easier to read',
        },
        {
          type: 'arrow',
          x: 50,
          y: 50,
          label: 'Normal view icon',
        },
        {
          type: 'label',
          x: 400,
          y: 400,
          label: 'Good settlement location: river + production',
        },
      ],
      estimatedDuration: 2,
      difficulty: 'beginner',
      learningObjectives: [
        'Understand when to use different game views',
        'Learn how to create view-switching actions',
        'Practice visual identification of good settlement sites',
      ],
      tryIt: {
        type: 'create-action',
        component: 'ActionBuilder',
        preloadedData: {
          actionName: 'Toggle Strategic View',
          actionDescription: 'Switch to strategic view for better settlement planning',
          actionType: 'view-toggle',
        },
        hints: [
          'In Civ 6, "V" key toggles between normal and strategic view',
          'The action should wait briefly after toggling (UI transition)',
          'Consider what "success" looks like—how do you confirm strategic view is active?',
          'Look for visual indicators: simplified unit graphics, different terrain coloring',
        ],
        successCriteria: {
          description: 'Create a working view toggle action that switches to strategic view',
          validation: {
            hasActionName: true,
            handlesTransition: true,
          },
        },
      },
      tips: [
        'Some players prefer normal view—you can adjust this action to use either',
        'The view toggle is reversible, so you can add a "Switch back" action later if needed',
        'Consider creating both "Enter Strategic View" and "Exit Strategic View" actions for reusability',
      ],
    },

    {
      id: 'step-6-move-settler',
      title: 'Move Settler to Settlement Site',
      content: `
# Creating the Movement Action

This is the core action: **moving the settler from current position to the optimal settlement location**.

## How Civ 6 Movement Works

In Civilization VI:
1. **Click the unit** to select it (we did this in step 4)
2. **Right-click the destination** (or click and drag)
3. **Confirm movement** (usually automatic, or press Enter)
4. **Wait for animation** (settler walks to destination)

## Model-Based Approach

Instead of hardcoding coordinates, we:

1. **Show examples**:
   - Screenshot: Settler at starting position
   - Screenshot: Same settler at destination
   - Qontinui learns the relationship

2. **Teach the pattern**:
   - "This is a settler" - learns unit appearance
   - "This is a river tile good for settlement" - learns terrain patterns
   - "This is movement completion" - learns the outcome

3. **Let it generalize**:
   - Works on different map seeds
   - Works with different terrain layouts
   - Works even if unit graphics slightly change

## The Action

Your action should:
1. Identify a good settlement location (from strategic view)
2. Click/navigate settler to that location
3. Confirm movement
4. Wait for animation
5. Return control

## Handling Edge Cases

Consider:
- What if there's no good location nearby?
- What if the settler can't reach the destination?
- What if a barbarian blocks the path?

(We'll handle these in the testing phase)

## Your Task

Create the movement action:
1. Use your strategic view screenshot from step 5
2. Identify a good settlement site
3. Create the action to move settler there
4. Make it robust to variations
`,
      screenshot: '/tutorials/civ6/step6-settler-movement.png',
      annotations: [
        {
          type: 'highlight',
          x: 200,
          y: 250,
          width: 40,
          height: 40,
          label: 'Settler starting position',
        },
        {
          type: 'arrow',
          x: 200,
          y: 300,
          label: 'Movement path',
        },
        {
          type: 'highlight',
          x: 250,
          y: 350,
          width: 40,
          height: 40,
          label: 'Destination: good settlement site',
        },
      ],
      estimatedDuration: 4,
      difficulty: 'intermediate',
      learningObjectives: [
        'Create complex actions with multiple steps',
        'Handle spatial reasoning and coordinate identification',
        'Test actions for robustness and adaptability',
        'Deal with movement mechanics and animations',
      ],
      tryIt: {
        type: 'create-action',
        component: 'ActionBuilder',
        preloadedData: {
          actionName: 'Move Settler to Settlement Site',
          actionDescription: 'Move the selected settler to a good location for founding a city',
          actionType: 'unit-movement',
        },
        hints: [
          'Look for terrain features: rivers, hills, resources',
          'Consider distance: not too close, not too far from capital',
          'What makes a "good" settlement site? Think about production, science, culture',
          'Right-click movement vs. click-and-drag—either can work in Civ 6',
          'Allow time for animation to complete before next action',
        ],
        successCriteria: {
          description: 'Create an action that moves a settler to an appropriate settlement location',
          validation: {
            hasActionName: true,
            hasDestinationLogic: true,
            handlesAnimation: true,
          },
        },
      },
      tips: [
        'Test your movement action with different settlers and different destination types',
        'Consider creating separate actions for different settlement strategies (aggressive expansion vs. defensive)',
        'You can reuse this action for multiple settlers in your automation',
      ],
    },

    {
      id: 'step-7-move-warrior-end-turn',
      title: 'Position Warrior & End Turn',
      content: `
# Completing the Turn

Now that we've positioned the settler, we need to handle the warrior and **end the turn** to proceed to the next turn's automation.

## Warrior Positioning

In early Civ 6:
- **One warrior** emerges from your capital
- **Needs positioning** for defense (near capital) or exploration (scouting barbarians)
- **Takes multiple turns** to be useful in combat

Common strategies:
- **Defense**: Position 1-2 tiles from your city
- **Exploration**: Move toward barbarian sources (usually edges of your known map)
- **Aggressive**: Move toward rivals if you know they're near

## Ending the Turn

The final action:
1. **Select the warrior** (using unit cycling like we did for settler)
2. **Position it** (right-click destination)
3. **Click "End Turn"** or press Enter/Space
4. **Wait for animations** and turn transition

## Combining Actions

This step teaches you to **chain actions together**:

\`\`\`
Action Sequence:
1. Select Settler (step 4)
2. Toggle Strategic View (step 5)
3. Move Settler (step 6)
4. Select Warrior (modified from step 4)
5. Position Warrior (similar to step 6)
6. End Turn ← We're here now
\`\`\`

Later, you'll combine all these into one automation sequence.

## Your Task

Create two actions:
1. **"Position Warrior"** - Similar to settler movement but with warrior-specific locations
2. **"End Turn"** - Click the end turn button and wait for completion

**Tip**: End Turn is simple but crucial—it's the trigger for your next turn's automation to begin.
`,
      screenshot: '/tutorials/civ6/step7-end-turn.png',
      annotations: [
        {
          type: 'highlight',
          x: 300,
          y: 250,
          width: 40,
          height: 40,
          label: 'Warrior unit',
        },
        {
          type: 'arrow',
          x: 300,
          y: 200,
          label: 'Defensive position',
        },
        {
          type: 'highlight',
          x: 50,
          y: 650,
          width: 100,
          height: 40,
          label: 'End Turn button',
        },
      ],
      estimatedDuration: 3,
      difficulty: 'intermediate',
      learningObjectives: [
        'Create actions for military unit positioning',
        'Understand turn-based game mechanics automation',
        'Learn how to detect turn completion',
        'Chain multiple actions into a sequence',
      ],
      tryIt: {
        type: 'create-action',
        component: 'ActionBuilder',
        preloadedData: {
          actionName: 'Position Warrior & End Turn',
          actionDescription:
            'Position the warrior appropriately and end the turn to advance to next turn',
          actionType: 'end-of-turn',
        },
        hints: [
          'Where should the warrior go? Consider defense vs. exploration',
          'How do you identify the End Turn button? Look for button text or icons',
          'Should you wait after clicking End Turn? (Yes—animations and server updates)',
          'Consider making warrior positioning configurable: different actions for different strategies',
        ],
        successCriteria: {
          description: 'Create a complete end-of-turn action that positions units and progresses the game',
          validation: {
            hasActionName: true,
            handlesTurnEnd: true,
          },
        },
      },
      tips: [
        'The End Turn button might be disabled if units still have moves—ensure all units are handled',
        'Different game difficulties might affect AI unit behavior—your action should be robust',
        'Consider adding a "Wait for turn completion" step to account for animation/server sync',
      ],
    },

    {
      id: 'step-8-test-automation',
      title: 'Test Your Complete Automation',
      content: `
# Bringing It All Together

You've created individual actions. Now it's time to **combine them into a complete automation sequence** and test it against your actual game.

## The Complete Workflow

Your automation should:

\`\`\`text
REPEAT FOR EACH EARLY GAME TURN:
├─ Select Settler with "!" (step 4)
├─ Toggle Strategic View (step 5)
├─ Move Settler to Settlement Site (step 6)
├─ Select Warrior (step 4 variant)
├─ Position Warrior (step 7 variant)
└─ End Turn (step 7)
\`\`\`

## Testing Strategy

1. **Unit test**: Each action individually
   - Does settler selection work?
   - Does movement complete?
   - Does end turn work?

2. **Integration test**: Actions in sequence
   - Do they work together?
   - Are timing/waits correct?
   - Any conflicts?

3. **Iteration test**: Multiple turns
   - Does it work turn 1? Turn 2? Turn 5?
   - Does it adapt to changing game state?
   - What breaks?

4. **Edge case test**: Unusual situations
   - Settler blocked by barbarian?
   - No good settlement site nearby?
   - Another civ's settler nearby?

## Handling Failures

When automation fails:
1. **Pause the game** - You can always stop it
2. **Review the screenshot** - What was it trying to do?
3. **Adjust the action** - Refine the pattern or logic
4. **Resume** - Continue from where you paused

This is the power of interactive automation—unlike scripts, you can intervene and guide the system.

## Success Criteria

Your automation is successful when:
- ✅ It completes 5+ turns without human intervention
- ✅ Settlers move to reasonable locations
- ✅ Warrior is positioned defensively
- ✅ Game advances correctly
- ✅ It adapts if you change something (different map, difficulty)

## Next Steps

Once your automation works:
1. **Refine it** - Improve accuracy, handle edge cases
2. **Extend it** - Add tech research, building selection, etc.
3. **Customize it** - Create variants for different strategies
4. **Share it** - Contribute to Qontinui community library

**Welcome to automated Civ 6!**
`,
      estimatedDuration: 5,
      difficulty: 'intermediate',
      learningObjectives: [
        'Integrate multiple actions into a complete workflow',
        'Test automation against real game scenarios',
        'Debug and refine automation based on results',
        'Handle edge cases and game state variations',
        'Understand the iterative nature of automation development',
      ],
      tryIt: {
        type: 'test-automation',
        component: 'AutomationTester',
        preloadedData: {
          automationName: 'Civ 6 Early Game Automation',
          actions: [
            'Select Settler with Pending Action',
            'Toggle Strategic View',
            'Move Settler to Settlement Site',
            'Position Warrior & End Turn',
          ],
          testScenarios: [
            {
              name: 'Basic Turn',
              description: 'Automate a standard turn with settler and warrior',
            },
            {
              name: 'Multiple Turns',
              description: 'Run automation for 3-5 consecutive turns',
            },
            {
              name: 'Pause and Resume',
              description: 'Pause automation, manually adjust, then resume',
            },
          ],
        },
        hints: [
          'Start with a single turn to verify each action works',
          'Watch the first run carefully—where does it struggle?',
          'Use pause/resume to handle unexpected situations',
          'Save your successful automation configuration',
          'Note which actions need refinement for next iteration',
        ],
        successCriteria: {
          description:
            'Successfully test and validate a multi-step automation sequence in actual gameplay',
          validation: {
            minTurnsCompleted: 2,
            noGameCrashes: true,
            settlerMovement: true,
            turnProgression: true,
          },
        },
      },
      tips: [
        'First successful run might be rough—expect a few iterations',
        'The most valuable data comes from failures—each failure teaches you something',
        'Consider recording your test runs to analyze what went wrong',
        'Different game seeds and difficulties are good tests of generalization',
        'Keep notes on action accuracy—identify patterns in what works and what fails',
      ],

      resources: [
        {
          title: 'Automation Debugging Guide',
          url: 'https://docs.qontinui.io/guides/debugging',
          type: 'documentation',
        },
        {
          title: 'Action Composition Patterns',
          url: 'https://docs.qontinui.io/patterns/action-composition',
          type: 'documentation',
        },
        {
          title: 'Civ 6 Community Automations',
          url: 'https://github.com/qontinui/community-automations',
          type: 'article',
        },
      ],
    },
  ],

  finalProject: {
    name: 'Civ 6 Early Game Automation',
    description:
      'A complete automation sequence for the first 10-15 turns of a Civilization VI game',
    components: [
      'Select Settler with Pending Action',
      'Toggle Strategic View',
      'Move Settler to Settlement Site',
      'Position Warrior & End Turn',
    ],
    expectedOutcome:
      'Fully automated early game unit management while you focus on strategic decisions',
    timeToAutomate: '15 minutes per game',
  },

  prerequisites: [],
};
