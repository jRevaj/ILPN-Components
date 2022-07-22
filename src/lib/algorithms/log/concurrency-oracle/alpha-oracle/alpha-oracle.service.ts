import {Injectable} from '@angular/core';
import {ConcurrencyOracle} from '../concurrency-oracle';
import {Trace} from '../../../../models/log/model/trace';
import {Observable, of} from 'rxjs';
import {PetriNet} from '../../../../models/pn/model/petri-net';
import {AlphaOracleConfiguration} from './alpha-oracle-configuration';
import {OccurrenceMatrix} from './occurrence-matrix';
import {PrefixTree} from '../../../../utility/prefix-tree';
import {PetriNetSequence} from './petri-net-sequence';
import {TraceConversionResult} from './trace-conversion-result';
import {Place} from '../../../../models/pn/model/place';
import {Transition} from '../../../../models/pn/model/transition';

enum PartialOrderNetComparisonResult {
    DIFFERENT,
    SAME,
    SUB_GRAPH
}


@Injectable({
    providedIn: 'root'
})
export class AlphaOracleService implements ConcurrencyOracle {

    public static readonly START_SYMBOL = '▶';
    public static readonly STOP_SYMBOL = '■';

    constructor() {
    }

    determineConcurrency(log: Array<Trace>, config: AlphaOracleConfiguration = {}): Observable<Array<PetriNet>> {
        if (log.length === 0) {
            return of([]);
        }

        const transformedTraces = this.convertLogToPetriNetSequences(log, config.lookAheadDistance);
        transformedTraces.nets.forEach(seq => {
            this.addStartAndStopEvent(seq);
        })
        const partialOrders = this.convertSequencesToPartialOrders(transformedTraces);
        this.removeTransitiveDependencies(partialOrders)
        if (!config.addStartStopEvent) {
            partialOrders.forEach(po => {
                this.removeStartAndStopEvent(po);
            })
        }
        const result = this.filterAndCombinePartialOrderNets(partialOrders, !!config.discardPrefixes);

        return of(result);
    }

    private convertLogToPetriNetSequences(log: Array<Trace>, lookAheadDistance: number = 1): TraceConversionResult {
        const netSequences = new Set<PetriNet>();
        const tree = new PrefixTree<PetriNetSequence>(new PetriNetSequence());
        const matrix = new OccurrenceMatrix();

        for (const trace of log) {
            const prefix: Array<string> = [];

            tree.insert(trace,
                () => {
                    throw new Error('should never be called');
                },
                node => {
                    node.net.frequency = node.net.frequency === undefined ? 1 : node.net.frequency + 1;
                    netSequences.add(node.net);
                },
                undefined,
                (step, previousNode) => {
                    // occurrence matrix
                    if (prefix.length > lookAheadDistance) {
                        prefix.shift();
                    }
                    for (const e of prefix) {
                        matrix.set(e, step);
                    }
                    prefix.push(step);

                    // create new node
                    const newNode = previousNode!.clone();
                    newNode.appendTransition(step);
                    return newNode;
                }
            );
        }

        return {
            nets: Array.from(netSequences.values()),
            occurrenceMatrix: matrix
        };
    }

    private addStartAndStopEvent(sequenceNet: PetriNet) {
        const firstLast = sequenceNet.getPlaces().filter(p => p.ingoingArcs.length === 0 || p.outgoingArcs.length === 0);
        if (firstLast.length !== 2) {
            console.debug(sequenceNet);
            throw new Error('Illegal state. A sequence must have one start and one end place.');
        }
        let first, last: Place;
        if (firstLast[0].ingoingArcs.length === 0) {
            first = firstLast[0];
            last = firstLast[1];
        } else {
            first = firstLast[1];
            last = firstLast[0];
        }

        const preStart = new Place();
        const start = new Transition(AlphaOracleService.START_SYMBOL);
        sequenceNet.addPlace(preStart);
        sequenceNet.addTransition(start);
        sequenceNet.addArc(preStart, start);
        sequenceNet.addArc(start, first);

        const stop = new Transition(AlphaOracleService.STOP_SYMBOL);
        const postStop = new Place();
        sequenceNet.addTransition(stop);
        sequenceNet.addPlace(postStop);
        sequenceNet.addArc(last, stop);
        sequenceNet.addArc(stop, postStop);
    }

    private removeStartAndStopEvent(partialOrder: PetriNet) {
        if (partialOrder.inputPlaces.size !== 1 || partialOrder.outputPlaces.size !== 1) {
            console.debug(partialOrder);
            throw new Error('illegal state');
        }

        let startTransition: Transition | undefined = undefined;
        partialOrder.inputPlaces.forEach(id => {
            const inPlace = partialOrder.getPlace(id)!;
            startTransition = inPlace.outgoingArcs[0].destination as Transition;
            partialOrder.removePlace(id);
        });

        if (startTransition === undefined || (startTransition as Transition).label !== AlphaOracleService.START_SYMBOL) {
            throw new Error('illegal state');
        }
        partialOrder.removeTransition(startTransition);

        let stopTransition: Transition | undefined = undefined;
        partialOrder.outputPlaces.forEach(id => {
            const outPlace = partialOrder.getPlace(id)!;
            stopTransition = outPlace.ingoingArcs[0].destination as Transition;
            partialOrder.removePlace(id);
        });

        if (stopTransition === undefined || (stopTransition as Transition).label !== AlphaOracleService.STOP_SYMBOL) {
            throw new Error('illegal state');
        }
        partialOrder.removeTransition(stopTransition);
    }

    private convertSequencesToPartialOrders(sequencesAndConcurrencyInformation: TraceConversionResult): Array<PetriNet> {
        return sequencesAndConcurrencyInformation.nets.map(seq => this.convertSequenceToPartialOrder(seq, sequencesAndConcurrencyInformation.occurrenceMatrix));
    }

    private convertSequenceToPartialOrder(sequence: PetriNet, hasOccurredInOrder: OccurrenceMatrix): PetriNet {
        const placeQueue = sequence.getPlaces();

        while (placeQueue.length > 0) {
            const place = placeQueue.shift() as Place;
            if (place.ingoingArcs.length === 0 || place.outgoingArcs.length === 0) {
                continue;
            }
            if (place.ingoingArcs.length > 1 || place.outgoingArcs.length > 1) {
                console.debug(place);
                console.debug(sequence);
                throw new Error('Illegal state. The processed net is not a partial order!');
            }

            const preEvent = (place.ingoingArcs[0].source as Transition);
            const postEvent = (place.outgoingArcs[0].destination as Transition);
            if (!hasOccurredInOrder.get(preEvent.label!, postEvent.label!) || !hasOccurredInOrder.get(postEvent.label!, preEvent.label!)) {
                continue;
            }

            sequence.removePlace(place);

            for (const a of preEvent.ingoingArcs) {
                const inPlace = a.source as Place;

                if (inPlace.ingoingArcs.length === 0 && postEvent.ingoingArcs.some(a => a.source.ingoingArcs.length === 0)) {
                    continue;
                }
                if (inPlace.ingoingArcs.length > 0) {
                    const inTransId = inPlace.ingoingArcs[0].source.id;
                    if (postEvent.ingoingArcs.some(a => a.source.id === inTransId)) {
                        continue;
                    }
                }

                const clone = new Place();
                sequence.addPlace(clone);
                placeQueue.push(clone);

                for (const inArc of inPlace.ingoingArcs) {
                    sequence.addArc(inArc.source as Transition, clone);
                }

                sequence.addArc(clone, postEvent)
            }

            for (const a of postEvent.outgoingArcs) {
                const outPlace = a.destination as Place;

                if (outPlace.outgoingArcs.length === 0 && preEvent.outgoingArcs.some(a => a.destination.outgoingArcs.length === 0)) {
                    continue;
                }
                if (outPlace.outgoingArcs.length > 0) {
                    const outTransId = outPlace.outgoingArcs[0].destination.id;
                    if (preEvent.outgoingArcs.some(a => a.destination.id === outTransId)) {
                        continue;
                    }
                }

                const clone = new Place();
                sequence.addPlace(clone);
                placeQueue.push(clone);

                for (const outArc of outPlace.outgoingArcs) {
                    sequence.addArc(clone, outArc.destination as Transition);
                }

                sequence.addArc(preEvent, clone)
            }
        }

        return sequence;
    }

    private removeTransitiveDependencies(nets: Array<PetriNet>) {
        nets.forEach(n => this.performTransitiveReduction(n));
    }

    private performTransitiveReduction(partialOrder: PetriNet) {
        // algorithm based on "Algorithm A" from https://www.sciencedirect.com/science/article/pii/0304397588900321
        // the paper itself offers an improvement over this Algorithm - might be useful if A proves to be too slow

        const transitionOrder = this.reverseTopologicalTransitionOrdering(partialOrder);

    }

    /**
     * Returns an array containing the transitions of the given net. The result is in reverse-topological order i.e.
     * transitions at the front of the Array appear later in the net.
     *
     * Implementation based on https://www.geeksforgeeks.org/topological-sorting/3
     * @param net a Petri Net representation of a partial order
     */
    private reverseTopologicalTransitionOrdering(net: PetriNet): Array<Transition> {
        const resultStack: Array<Transition> = [];
        const visited = new Set<string>();
        for (const t of net.getTransitions()) {
            if (visited.has(t.getId())) {
                continue;
            }
            this.topologicalOrderingUtil(t, visited, resultStack);
        }
        return resultStack;
    }

    private topologicalOrderingUtil(t: Transition, visited: Set<string>, resultStack: Array<Transition>) {
        visited.add(t.getId());
        for (const a of t.outgoingArcs) {
            const nextTransition = a.destination.outgoingArcs[0]?.destination;
            if (nextTransition === undefined) {
                continue;
            }
            if (visited.has(nextTransition.getId())) {
                continue;
            }
            this.topologicalOrderingUtil(nextTransition as Transition, visited, resultStack);
        }
        resultStack.push(t);
    }

    private filterAndCombinePartialOrderNets(nets: Array<PetriNet>, discardPrefixes: boolean): Array<PetriNet> {
        // descending based on the number of transitions (events)
        nets.sort((n1, n2) => n2.getTransitionCount() - n1.getTransitionCount());

        const unique: Array<PetriNet> = [nets.shift()!];

        for (const smallerNet of nets) {
            let discard = false;
            for (const largerNet of unique) {
                const result = this.compareNets(smallerNet, largerNet, discardPrefixes);
                switch (result) {
                    case PartialOrderNetComparisonResult.SAME:
                        discard = true;
                        largerNet.frequency = largerNet.frequency! + smallerNet.frequency!;
                        break;
                    case PartialOrderNetComparisonResult.SUB_GRAPH:
                        discard = true;
                        break;
                }
                if (discard) {
                    break;
                }
            }
            if (!discard) {
                unique.push(smallerNet);
            }
        }

        return unique;
    }

    private compareNets(smaller: PetriNet, larger: PetriNet, checkSubGraph: boolean): PartialOrderNetComparisonResult {

    }
}
