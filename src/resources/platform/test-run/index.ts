import {extendResource} from '../../../core/extend-resource.js'
import {type TestRunStatus, waitForState, type WaitForStateOptions} from './wait-for-state.js'

export {
  TestRunNotReadyError, type TestRunStatus, waitForState, type WaitForStateOptions,
} from './wait-for-state.js'

// Resource key MUST be the camelCase `'testRun'` — it matches the generated
// route-group export name that `mergeExtensions` looks up on the platform
// client. The directory stays kebab (`test-run/`).
export const testRunExtensions = extendResource('platform', 'testRun', ctx => ({
  waitForState: (
    pipelineId: string,
    testRunNumber: number,
    targetStates: ReadonlyArray<string | TestRunStatus>,
    options?: WaitForStateOptions,
  ) => waitForState(ctx, pipelineId, testRunNumber, targetStates, options),
}))
