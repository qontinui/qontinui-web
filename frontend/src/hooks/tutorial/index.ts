/**
 * Tutorial Hooks
 *
 * Re-exports all tutorial-related hooks.
 */

export {
  useDOMObserver,
  useDOMObserverMultiple,
  useElementExists,
  useElementVisible,
  type ObservationType,
  type DOMObserverOptions,
  type DOMObserverResult,
} from "./useDOMObserver";

export {
  useTutorialKeyboard,
  getKeyboardShortcuts,
  type TutorialKeyboardOptions,
} from "./useTutorialKeyboard";

export {
  useTutorialEvents,
  useTutorialNotify,
  dispatchTutorialAction,
  type UseTutorialEventsOptions,
  type UseTutorialEventsResult,
} from "./useTutorialEvents";
