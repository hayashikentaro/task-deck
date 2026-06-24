# Single Decision-Aware Agent Team

This team contains one TaskDeck App Server task.

The task has one role: `decision-aware-implementation-controller`.

The task acts as a solo autonomous implementation controller. Human intervention after launch should normally happen only through Decision Gateway. The TaskDeck composer is for launch and exceptional recovery, not normal operation.

This is the first minimal configuration for product-like Decision Gateway operation. It is not multi-agent orchestration, Main/Worker splitting, or a manager-mediated loop.
