/**
 * @license
 * Copyright 2020 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {Pipe, PipeTransform} from '@angular/core';

import {Point} from './model';
import {pointsToLines} from './paths';

/**
 * An Angular pipe that, given a list of X/Y coordinates, returns an SVG path
 * string describing how to connect them with a line.
 */
@Pipe({
  standalone: false,
  name: 'edgePath',
  pure: true,
})
export class EdgePipe implements PipeTransform {
  transform(points?: Point[]): string {
    return pointsToLines(points);
  }
}
