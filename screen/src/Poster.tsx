// A game's poster: art/posters/<game id>.webp when there is one, else the art the game came with.

import { useState, type ReactElement } from "react";

/**
 * Draws a game's poster.
 * @param props the game's id, the art it came with (used when the id has no poster) and an optional class.
 * @returns the picture.
 */
export function Poster(props: { id: string; art: string; className?: string }): ReactElement {
    const [missing, setMissing] = useState<boolean>(false);
    return <img className={props.className} src={missing ? props.art : `art/posters/${props.id}.webp`} alt="" onError={() => setMissing(true)} />;
}
