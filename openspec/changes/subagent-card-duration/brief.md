# Elapsed time on subagent cards

The card and attempt detail in the Subagents panel now share the chat row's elapsed-time component. Live attempts update every 15 seconds. Settled attempts use the recorded end time. Historical card projections with only a sort key omit the duration.

The new card rendering regression failed on the previous implementation and passed after the change. The frontend suite passed all 109 tests. The regression measures a 62-minute completed attempt independently of the current date.
