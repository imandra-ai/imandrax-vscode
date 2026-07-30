import { CancellationToken, CancellationError } from "vscode";

export function cancellable<T>(
    promise: PromiseLike<T>,
    token: CancellationToken
): Promise<T> {
    return new Promise<T>((resolve, reject) => {
        const reg = token.onCancellationRequested(() => {
            reject(new CancellationError());
            reg.dispose();
        });

        promise.then(
            (val: T) => { reg.dispose(); resolve(val); },
            (err: Error) => { reg.dispose(); reject(err); }
        );
    });
}