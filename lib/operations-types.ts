export type ScheduleFrequency = 'daily' | 'weekly';
export type CollectionSchedule = {
  id:string;siteId:string;name:string;enabled:boolean;frequency:ScheduleFrequency;timezone:string;hour:number;minute:number;weekdays:number[];models:string[];promptIds:string[]|null;
  nextRunAt:string;endsAt:string|null;lastRunAt:string|null;lastStatus:string|null;createdAt:string;updatedAt:string;
};
export type ScheduledExecution = {id:string;scheduleId:string|null;siteId:string;scheduleName:string;scheduledFor:string;status:'queued'|'running'|'completed'|'partial'|'failed'|'blocked'|'cancelled';runId:string|null;attempts:number;completed:number;failed:number;total:number;errorCode:string|null;message:string|null;createdAt:string;updatedAt:string;completedAt:string|null;queueDelayMs:number|null;completionDelayMs:number|null};
export type OperationAlert = {id:string;siteId:string;executionId:string|null;severity:'warning'|'critical';code:string;title:string;message:string;status:'open'|'acknowledged'|'resolved';createdAt:string;updatedAt:string};
export type OperationAudit = {id:string;siteId:string;action:string;subjectId:string|null;summary:string;createdAt:string};
export type OperationsHealth = {status:'healthy'|'attention'|'not_observed';lastHeartbeatAt:string|null;lastSuccessAt:string|null;activeExecutions:number;openAlerts:number;enabledSchedules:number;serviceSecretConfigured:boolean;checkedAt:string;heartbeatAgeMs:number|null;oldestDueDelayMs:number|null;overdueScheduleCount:number;staleAfterMs:number;message:string};
export type OperationsState = {schedules:CollectionSchedule[];executions:ScheduledExecution[];alerts:OperationAlert[];audit:OperationAudit[];health:OperationsHealth;observability:{history:TickHistory;executionDelays:ExecutionDelaySummary}};
export type AutomationTickResult = {tickId:string;queued:number;processed:number;completed:number;failed:number;blocked:number;continuation:boolean;retryAfterSeconds:number;skipped:boolean;executionIds:string[];runIds:string[]};
export type ScheduleInput = {siteId:string;name:string;enabled?:boolean;endsAt?:string|null;frequency:ScheduleFrequency;timezone:string;hour:number;minute:number;weekdays?:number[];models:string[];promptIds?:string[]|null};

export type TickEntryPoint = 'mcp_owner'|'mcp_operator'|'service_bearer'|'run_now_api'|'internal';
export type OperationTick = {id:string;scope:'owner'|'service';entryPoint:TickEntryPoint;status:'started'|'completed'|'failed'|'skipped';startedAt:string;finishedAt:string|null;durationMs:number|null;queued:number;processed:number;completed:number;failed:number;blocked:number;skipped:boolean;continuation:boolean;errorCode:string|null;unfinished:boolean};
export type TickHistory = {available:boolean;includesService:boolean;ticks:OperationTick[];window:{since:string;until:string;limit:number;retentionDays:number;perScopeLimit:number;globalLimit:number;retainedCount:number|null;truncated:boolean}};
export type ExecutionDelaySummary = {sampleSize:number;totalCount:number;limit:number;truncated:boolean;observedFrom:string|null;observedTo:string|null;checkedAt:string;includesImmediateRuns:true;queueSampleSize:number;completionSampleSize:number;queueP50Ms:number|null;queueP95Ms:number|null;queueMaxMs:number|null;completionP50Ms:number|null;completionP95Ms:number|null;queueOverOneHourCount:number};
