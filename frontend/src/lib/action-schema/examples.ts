/**
 * Examples demonstrating the new action schema system
 */

import { createAction, Action } from "./action-types";

/**
 * Example 1: Simple CLICK action
 * Type-safe configuration with only relevant properties
 */
export const clickExample: Action<"CLICK"> = createAction(
  "CLICK",
  {
    target: "Last Find Result",
    numberOfClicks: 1,
    mouseButton: "LEFT",
    verify: {
      mode: "IMAGE_APPEARS",
      target: {
        type: "image",
        imageId: "confirmation-456",
      },
      timeout: 3000,
    },
  },
  [0, 0],
  {
    name: "Click submit button",
    base: {
      pauseBeforeBegin: 100,
      pauseAfterEnd: 500,
    },
    execution: {
      timeout: 10000,
      retryCount: 2,
      continueOnError: false,
    },
  }
);

/**
 * Example 2: TYPE action with state string source
 * Shows how to reference state strings
 */
export const typeExample: Action<"TYPE"> = createAction(
  "TYPE",
  {
    textSource: {
      stateId: "login-form",
      stringIds: ["username-string-789"],
      useAll: false,
    },
    typeDelay: 50,
    clearBefore: true,
    clickTarget: {
      type: "image",
      imageId: "username-field-101",
    },
  },
  [0, 0]
);

/**
 * Example 3: LOOP action - NEW control flow
 * Demonstrates iterating and performing actions
 */
export const loopExample: Action<"LOOP"> = createAction(
  "LOOP",
  {
    loopType: "FOR",
    iterations: 10,
    iteratorVariable: "i",
    actions: ["action-collect-item", "action-store-item"],
    maxIterations: 100, // Safety limit
  },
  [0, 0],
  {
    name: "Collect 10 items",
  }
);

/**
 * Example 4: LOOP with condition - WHILE loop
 */
export const whileLoopExample: Action<"LOOP"> = createAction(
  "LOOP",
  {
    loopType: "WHILE",
    condition: {
      type: "image_exists",
      imageId: "more-items-button",
    },
    actions: ["action-click-more", "action-wait-loading"],
    maxIterations: 50,
  },
  [0, 0],
  {
    name: "Load all items",
  }
);

/**
 * Example 5: FOREACH loop iterating over matches
 */
export const foreachExample: Action<"LOOP"> = createAction(
  "LOOP",
  {
    loopType: "FOREACH",
    collection: {
      type: "matches",
      target: {
        type: "image",
        imageId: "list-item-pattern",
        searchOptions: {
          strategy: "ALL",
        },
      },
    },
    iteratorVariable: "item",
    actions: ["action-click-item", "action-process-item"],
  },
  [0, 0],
  {
    name: "Process all list items",
  }
);

/**
 * Example 6: SORT action - NEW data operation
 * Sort a collection of items
 */
export const sortExample: Action<"SORT"> = createAction(
  "SORT",
  {
    target: "variable",
    variableName: "inventory_items",
    sortBy: "price",
    order: "ASC",
    comparator: "NUMERIC",
    outputVariable: "sorted_items",
  },
  [0, 0],
  {
    name: "Sort items by price",
  }
);

/**
 * Example 7: IF conditional - NEW control flow
 */
export const ifExample: Action<"IF"> = createAction(
  "IF",
  {
    condition: {
      type: "image_exists",
      imageId: "premium-badge",
    },
    thenActions: ["action-use-premium-features"],
    elseActions: ["action-show-upgrade-prompt"],
  },
  [0, 0],
  {
    name: "Check if premium user",
  }
);

/**
 * Example 8: SET_VARIABLE from OCR
 */
export const setVariableExample: Action<"SET_VARIABLE"> = createAction(
  "SET_VARIABLE",
  {
    variableName: "player_gold",
    valueSource: {
      type: "ocr",
      target: {
        type: "region",
        region: { x: 100, y: 50, width: 80, height: 30 },
      },
    },
    type: "number",
    scope: "global",
  },
  [0, 0],
  {
    name: "Read gold amount",
  }
);

/**
 * Example 9: FILTER action
 */
export const filterExample: Action<"FILTER"> = createAction(
  "FILTER",
  {
    variableName: "all_items",
    condition: {
      type: "property",
      property: "rarity",
      operator: "==",
      value: "legendary",
    },
    outputVariable: "legendary_items",
  },
  [0, 0],
  {
    name: "Filter legendary items",
  }
);

/**
 * Example 10: Complex DRAG action
 */
export const dragExample: Action<"DRAG"> = createAction(
  "DRAG",
  {
    source: {
      type: "image",
      imageId: "inventory-item",
    },
    destination: {
      type: "region",
      region: { x: 500, y: 300, width: 100, height: 100 },
    },
    dragDuration: 500,
    verify: {
      mode: "IMAGE_DISAPPEARS",
      target: {
        type: "image",
        imageId: "inventory-item",
      },
      timeout: 2000,
    },
  },
  [0, 0],
  {
    name: "Move item to stash",
  }
);

/**
 * Example 11: TRY_CATCH for error handling
 */
export const tryCatchExample: Action<"TRY_CATCH"> = createAction(
  "TRY_CATCH",
  {
    tryActions: ["action-risky-operation", "action-verify-success"],
    catchActions: ["action-log-error", "action-recover"],
    finallyActions: ["action-cleanup"],
    errorVariable: "last_error",
  },
  [0, 0],
  {
    name: "Try risky operation",
  }
);

/**
 * Example 12: MATH_OPERATION
 */
export const mathExample: Action<"MATH_OPERATION"> = createAction(
  "MATH_OPERATION",
  {
    operation: "ADD",
    operands: [
      { variableName: "current_gold" },
      500, // Adding 500 gold
    ],
    outputVariable: "new_gold_total",
  },
  [0, 0],
  {
    name: "Calculate new gold total",
  }
);

/**
 * Example demonstrating type safety
 * TypeScript will enforce that the config matches the action type
 */
export function demonstrateTypeSafety() {
  // ✅ Valid - config matches CLICK type
  createAction(
    "CLICK",
    {
      target: "Last Find Result",
      numberOfClicks: 1,
    },
    [0, 0]
  );

  // ❌ TypeScript error - CLICK doesn't have 'text' property
  // const invalidClick = createAction('CLICK', {
  //   text: 'Hello' // Error: 'text' does not exist in type 'ClickActionConfig'
  // });

  // ✅ Valid - config matches TYPE type
  createAction(
    "TYPE",
    {
      text: "Hello world",
      typeDelay: 50,
    },
    [0, 0]
  );

  // ❌ TypeScript error - TYPE doesn't have 'numberOfClicks'
  // const invalidType = createAction('TYPE', {
  //   numberOfClicks: 2 // Error: 'numberOfClicks' does not exist in type 'TypeActionConfig'
  // });
}

/**
 * Example: JSON output comparison
 */
export const jsonComparisonOld = {
  // OLD FORMAT - 100+ properties, most irrelevant
  id: "action-123",
  type: "CLICK",
  config: {
    target: { type: "image", imageId: "img-1" },
    similarity: 0.8,
    numberOfClicks: 1,
    mouseButton: "LEFT",
    pressDuration: 100,
    pauseBeforeBegin: 0,
    pauseAfterEnd: 0,
    typeDelay: 50, // ❌ Not relevant to CLICK
    dragDuration: 500, // ❌ Not relevant to CLICK
    maxWaitTime: 5000, // ❌ Not relevant to CLICK
    // ... 90+ more irrelevant properties
  },
  timeout: 10000,
  retryCount: 0,
  continueOnError: true,
};

export const jsonComparisonNew = {
  // NEW FORMAT - Only relevant properties
  id: "action-123",
  type: "CLICK",
  config: {
    target: {
      type: "image",
      imageId: "img-1",
      searchOptions: {
        similarity: 0.8,
      },
    },
    numberOfClicks: 1,
    mouseButton: "LEFT",
    pressDuration: 100,
  },
  base: {
    pauseBeforeBegin: 0,
    pauseAfterEnd: 0,
  },
  execution: {
    timeout: 10000,
    retryCount: 0,
    continueOnError: true,
  },
};

console.log("Old format size:", JSON.stringify(jsonComparisonOld).length);
console.log("New format size:", JSON.stringify(jsonComparisonNew).length);
console.log(
  "Size reduction:",
  Math.round(
    (1 -
      JSON.stringify(jsonComparisonNew).length /
        JSON.stringify(jsonComparisonOld).length) *
      100
  ),
  "%"
);
