export class AlreadyFavoriteError extends Error {
  constructor(public readonly appName: string) {
    super(`App ${appName} is already a favorite.`)
    this.name = 'AlreadyFavoriteError'
  }
}

export class NotFavoriteError extends Error {
  constructor(public readonly appName: string) {
    super(`App ${appName} is not a favorite.`)
    this.name = 'NotFavoriteError'
  }
}

export class AppNotFoundError extends Error {
  constructor(public readonly appName: string, cause: unknown) {
    super(`Couldn't find app ${appName}.`, {cause})
    this.name = 'AppNotFoundError'
  }
}

export class FavoriteCreateError extends Error {
  constructor(public readonly appName: string, cause: unknown) {
    super(`Failed to add app ${appName} as a favorite.`, {cause})
    this.name = 'FavoriteCreateError'
  }
}
