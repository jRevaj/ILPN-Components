import {Injectable} from '@angular/core';
import {ConcurrencyRelation} from '../model/concurrency-relation';
import {AbstractParser} from '../../../utility/abstract-parser';
import {Relabeler} from '../../../utility/relabeler';

@Injectable({
    providedIn: 'root'
})
export class ConcurrencyParserService extends AbstractParser<ConcurrencyRelation> {

    protected static LINE_REGEX = /^(.+?)(?:\[([1-9]\d*)\])?(?:\|\||∥)(.+?)(?:\[([1-9]\d*)\])?$/;

    constructor() {
        super('concurrency');
    }

    protected processFileLines(lines: Array<string>): ConcurrencyRelation | undefined {
        const result = ConcurrencyRelation.noConcurrency();
        const relabeler = result.relabeler;

        for (const line of lines) {
            if (line.trimEnd().length === 0) {
                continue;
            }

            const match = line.match(ConcurrencyParserService.LINE_REGEX);
            if (match === null) {
                console.debug(line);
                console.debug('line could not be matched with regex');
                continue;
            }

            const eventA = this.getUniqueLabel(match[1], parseInt(match[2]), relabeler);
            const eventB = this.getUniqueLabel(match[3], parseInt(match[4]), relabeler);

            result.setConcurrent(eventA, eventB);
        }

        relabeler.restartSequence();
        return result;
    }

    protected getUniqueLabel(label: string, oneBasedOrder: number, relabeler: Relabeler): string {
        if (isNaN(oneBasedOrder)) {
            // TODO wildcards
            throw new Error('unsupported');
        }

        const storedOrder = relabeler.getLabelMapping().get(label);
        const storedLabel = storedOrder?.[oneBasedOrder - 1];
        if (storedLabel !== undefined) {
            return storedLabel;
        }

        let missingCount;
        if (storedOrder === undefined) {
            missingCount = oneBasedOrder;
        } else {
            missingCount = storedOrder.length - oneBasedOrder;
        }

        let missingLabel: string;
        for (let i = 0; i < missingCount; i++) {
            missingLabel = relabeler.getNewLabel(label);
        }

        return missingLabel!;
    }
}
