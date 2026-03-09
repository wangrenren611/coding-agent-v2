# Agent-V4 Error Contract (P0-1 Frozen)

## Envelope
All surfaced errors should be serializable to the same envelope:

```json
{
  "module": "agent|tool",
  "name": "ErrorClassName",
  "code": 1005,
  "errorCode": "AGENT_UNKNOWN_ERROR",
  "message": "Human readable message",
  "category": "validation|timeout|abort|permission|not_found|conflict|rate_limit|internal",
  "retryable": false,
  "httpStatus": 500,
  "details": {}
}
```

## Agent Error Codes
| code | errorCode | class | category | retryable | httpStatus |
|---|---|---|---|---|---|
| 1000 | `AGENT_ERROR` | `AgentError` | `internal` | false | 500 |
| 1001 | `AGENT_QUERY_EMPTY` | `AgentQueryError` | `validation` | false | 400 |
| 1002 | `AGENT_ABORTED` | `AgentAbortedError` | `abort` | false | 499 |
| 1003 | `AGENT_MAX_RETRIES_REACHED` | `MaxRetriesError` | `timeout` | false | 504 |
| 1004 | `AGENT_CONFIRMATION_TIMEOUT` | `ConfirmationTimeoutError` | `timeout` | true | 408 |
| 1005 | `AGENT_UNKNOWN_ERROR` | `UnknownError` | `internal` | false | 500 |
| 1006 | `AGENT_TIMEOUT_BUDGET_EXCEEDED` | `TimeoutBudgetExceededError` | `timeout` | false | 504 |
| 1007 | `AGENT_UPSTREAM_RATE_LIMIT` | `AgentUpstreamRateLimitError` | `rate_limit` | true | 429 |
| 1008 | `AGENT_UPSTREAM_TIMEOUT` | `AgentUpstreamTimeoutError` | `timeout` | true | 504 |
| 1009 | `AGENT_UPSTREAM_NETWORK` | `AgentUpstreamNetworkError` | `internal` | true | 503 |
| 1010 | `AGENT_UPSTREAM_SERVER` | `AgentUpstreamServerError` | `internal` | true | 502 |
| 1011 | `AGENT_UPSTREAM_AUTH` | `AgentUpstreamAuthError` | `permission` | false | 401 |
| 1012 | `AGENT_UPSTREAM_NOT_FOUND` | `AgentUpstreamNotFoundError` | `not_found` | false | 404 |
| 1013 | `AGENT_UPSTREAM_BAD_REQUEST` | `AgentUpstreamBadRequestError` | `validation` | false | 400 |
| 1014 | `AGENT_UPSTREAM_PERMANENT` | `AgentUpstreamPermanentError` | `internal` | false | 500 |
| 1015 | `AGENT_UPSTREAM_RETRYABLE` | `AgentUpstreamRetryableError` | `internal` | true | 503 |
| 1016 | `AGENT_UPSTREAM_ERROR` | `AgentUpstreamError` | `internal` | false | 500 |

## Tool Error Codes
| code | errorCode | class | category | retryable | httpStatus |
|---|---|---|---|---|---|
| 2000 | `TOOL_EXECUTION_ERROR` | `ToolExecutionError` | `internal` | true | 500 |
| 2001 | `TOOL_NAME_EMPTY` | `EmptyToolNameError` | `validation` | false | 400 |
| 2002 | `TOOL_INVALID_ARGUMENTS` | `InvalidArgumentsError` | `validation` | false | 400 |
| 2003 | `TOOL_NOT_FOUND` | `ToolNotFoundError` | `not_found` | false | 404 |
| 2004 | `TOOL_VALIDATION_FAILED` | `ToolValidationError` | `validation` | false | 400 |
| 2005 | `TOOL_DENIED` | `ToolDeniedError` | `permission` | false | 403 |
| 2006 | `TOOL_POLICY_DENIED` | `ToolPolicyDeniedError` | `permission` | false | 403 |

## Compatibility
- Existing `name/message/code` behavior remains unchanged.
- New fields are additive: `errorCode/category/retryable/httpStatus/details`.
- `runStream` `type=error` event now includes full envelope fields.

## Policy Hook
- `AgentCallbacks.onToolPolicy` can be provided by the outer layer.
- `DefaultToolManager` calls `onPolicyCheck` before confirmation and tool execution.
- When denied, manager returns `ToolPolicyDeniedError` with standardized reason code/message.
